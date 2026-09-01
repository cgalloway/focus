/* ---------------------------------------------------------------------------
 * focus-sync.js — cross-device sync for Focus, using Todoist as the backend.
 *
 * WHY TODOIST: the app already authenticates to Todoist on every device, so
 * using it as the state store means no new server, no new account, and no
 * credentials to manage. State lives in the `description` of a single task in
 * a dedicated "Focus Sync" project, gzipped and base64'd.
 *
 * THE MERGE MODEL is the important part. State splits into two kinds:
 *
 *   Accumulators (stats, elapsed) — every device adds to these independently.
 *     Stored in PER-DEVICE buckets and summed on read. A device only ever
 *     writes its own bucket, which makes merging idempotent: re-syncing the
 *     same data can never double-count, and no device's work is ever lost.
 *     (A naive `max()` merge would silently discard the smaller side; a naive
 *     `sum()` merge would double-count on every round trip. Buckets avoid both.)
 *
 *   Current-state (session, goals, settings) — these describe "how things are
 *     right now", not "how much happened". Last-write-wins on a timestamp is
 *     correct here: the newer intent should replace the older one.
 *
 * The session stores task IDs only, not full task objects. Both devices already
 * sync the real task bodies from Todoist, so storing IDs keeps the blob tiny
 * and means task text can never go stale.
 * ------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var API = 'https://api.todoist.com/api/v1';
  var PROJECT_NAME = 'Focus Sync';
  var STATE_TASK = 'focus-state';
  var MAGIC = 'FS1:';           // marks a gzip+base64 payload
  var MAGIC_RAW = 'FS0:';       // uncompressed fallback
  var DESC_LIMIT = 16000;       // Todoist caps descriptions at 16384
  var STATS_SYNC_DAYS = 180;    // trim history sent over the wire

  // Cached Todoist IDs, so steady-state sync is one request instead of three.
  var LS_IDS = 'focus_sync_ids_v1';
  var LS_DEVICE = 'focus_device_id_v1';
  var LS_CACHE = 'focus_sync_cache_v1'; // last known remote blob, for offline reads

  var FETCH_TIMEOUT_MS = 15000; // a hung request must never wedge the engine
  var FLUSH_REUSE_MS = 20000;   // flush() may skip the read if one landed this recently
  var BACKOFF_BASE_MS = 15000;  // first retry delay after a failure; doubles each time
  var BACKOFF_MAX_MS = 5 * 60000;

  var cfg = null;      // { getToken, getLocalState, onRemote, log }
  var ids = null;      // { projectId, taskId }
  var deviceId = null;
  var remote = emptyBlob();
  var pushTimer = null;
  var pushDeadline = 0;  // wall-clock ms the pending pushTimer fires at
  var inFlightPromise = null; // the running sync(); concurrent callers share it
  var rerunOpts = null;       // a call that arrived mid-flight — run once more after
  var lastPushedJSON = '';
  var lastReadAt = 0;         // when readRemote() last returned
  var failures = 0;           // consecutive sync failures, drives the backoff
  var backoffUntil = 0;       // no automatic sync before this wall-clock ms

  // ---- small helpers -------------------------------------------------------

  function log() {
    if (cfg && cfg.log) cfg.log.apply(null, arguments);
  }

  function emptyBlob() {
    return { v: 1, devices: {}, stats: {}, elapsed: {}, session: null, goals: null, settings: null };
  }

  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getDeviceId() {
    if (deviceId) return deviceId;
    try {
      deviceId = localStorage.getItem(LS_DEVICE);
    } catch (e) { /* storage blocked */ }
    if (!deviceId) {
      deviceId = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem(LS_DEVICE, deviceId); } catch (e) {}
    }
    return deviceId;
  }

  function deviceName() {
    var ua = (global.navigator && navigator.userAgent) || '';
    if (global.focusAPI) return 'Mac (desktop app)';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Macintosh/.test(ua)) return 'Mac (browser)';
    return 'Other device';
  }

  // ---- compression ---------------------------------------------------------
  // CompressionStream is in Safari 16.4+ and Chromium 80+, which covers both an
  // installed iOS PWA and Electron 28. When it's missing we fall back to raw
  // JSON rather than failing — sync still works, just with a smaller ceiling.

  function bytesToB64(bytes) {
    var out = '';
    // Chunked: String.fromCharCode.apply blows the stack on large arrays.
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(out);
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function encode(obj) {
    var json = JSON.stringify(obj);
    if (typeof CompressionStream === 'undefined') return MAGIC_RAW + json;
    try {
      var cs = new CompressionStream('gzip');
      var stream = new Blob([json]).stream().pipeThrough(cs);
      var buf = await new Response(stream).arrayBuffer();
      return MAGIC + bytesToB64(new Uint8Array(buf));
    } catch (e) {
      return MAGIC_RAW + json;
    }
  }

  async function decode(text) {
    if (!text) return null;
    text = String(text).trim();
    try {
      if (text.indexOf(MAGIC_RAW) === 0) return JSON.parse(text.slice(MAGIC_RAW.length));
      if (text.indexOf(MAGIC) !== 0) return null;
      var bytes = b64ToBytes(text.slice(MAGIC.length));
      var ds = new DecompressionStream('gzip');
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      var json = await new Response(stream).text();
      return JSON.parse(json);
    } catch (e) {
      log('focus-sync: could not decode remote blob', e);
      return null;
    }
  }

  // ---- Todoist plumbing ----------------------------------------------------

  // Every request is bounded: a request that never answers (common on a phone
  // right after a network switch) used to leave inFlight set forever and block
  // all later syncs. Errors carry `status` so sync() can tell a revoked token
  // (stop and tell the user) from a blip (back off and retry).
  async function api(path, opts) {
    var token = await cfg.getToken();
    if (!token) throw new Error('no token');
    opts = opts || {};
    var headers = { 'Authorization': 'Bearer ' + token };
    if (opts.body) headers['Content-Type'] = 'application/json';
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS) : null;
    var res;
    try {
      res = await fetch(API + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        // keepalive lets the final write on backgrounding outlive the page.
        keepalive: !!opts.keepalive,
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      var err = new Error((e && e.name === 'AbortError' ? 'timeout' : 'network error') + ' on ' + path);
      err.status = 0;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      var httpErr = new Error('HTTP ' + res.status + ' on ' + path);
      httpErr.status = res.status;
      throw httpErr;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // Todoist v1 list endpoints are cursor-paginated: { results, next_cursor }.
  async function listAll(path) {
    var out = [], cursor = null;
    do {
      var url = path + (path.indexOf('?') === -1 ? '?' : '&') + 'limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      var data = await api(url);
      if (Array.isArray(data)) return data;               // defensive: older shape
      out = out.concat((data && data.results) || []);
      cursor = data && data.next_cursor;
    } while (cursor);
    return out;
  }

  function loadIds() {
    try { return JSON.parse(localStorage.getItem(LS_IDS) || 'null'); } catch (e) { return null; }
  }
  function saveIds(v) {
    try { localStorage.setItem(LS_IDS, JSON.stringify(v)); } catch (e) {}
  }

  // Find (or create) the project + task that hold the blob. Cached in
  // localStorage; a stale cache self-heals because callers drop `ids` on 404.
  async function ensureStore() {
    if (ids && ids.projectId && ids.taskId) return ids;
    ids = loadIds();
    if (ids && ids.projectId && ids.taskId) return ids;

    var projects = await listAll('/projects');
    var proj = projects.filter(function (p) { return p.name === PROJECT_NAME; })[0];
    if (!proj) {
      proj = await api('/projects', { method: 'POST', body: { name: PROJECT_NAME } });
      log('focus-sync: created project', proj && proj.id);
    }

    var tasks = await listAll('/tasks?project_id=' + encodeURIComponent(proj.id));
    var task = tasks.filter(function (t) { return t.content === STATE_TASK; })[0];
    if (!task) {
      task = await api('/tasks', {
        method: 'POST',
        body: {
          content: STATE_TASK,
          project_id: proj.id,
          description: MAGIC_RAW + JSON.stringify(emptyBlob())
        }
      });
      log('focus-sync: created state task', task && task.id);
    }

    ids = { projectId: String(proj.id), taskId: String(task.id) };
    saveIds(ids);
    return ids;
  }

  async function readRemote() {
    var s = await ensureStore();
    var task;
    try {
      task = await api('/tasks/' + s.taskId);
    } catch (e) {
      // Task was deleted or the cached id is stale — forget it and rebuild once.
      if (/HTTP 404/.test(e.message)) {
        ids = null;
        try { localStorage.removeItem(LS_IDS); } catch (e2) {}
        s = await ensureStore();
        task = await api('/tasks/' + s.taskId);
      } else throw e;
    }
    var text = task && task.description ? String(task.description).trim() : '';
    // An empty description means the store was wiped by hand; there is nothing
    // left to protect, so seeding it from this device is the right recovery.
    // Forget what we last pushed, or the "unchanged, skip the write" shortcut
    // would leave the store empty until something local happened to change.
    if (!text) { lastPushedJSON = ''; return emptyBlob(); }
    var blob = await decode(text);
    if (!blob) {
      // NON-empty but undecodable: a newer format from another device, or a
      // transient decode failure. Writing here would replace every other
      // device's buckets with this device's alone — so refuse, and leave the
      // remote untouched until it can be read. (Deleting the focus-state task
      // in Todoist resets the store if it really is garbage.)
      var err = new Error('remote state could not be decoded — not overwriting it');
      err.status = -1;
      throw err;
    }
    return blob;
  }

  async function writeRemote(blob, opts) {
    var s = await ensureStore();
    var desc = await encode(blob);
    if (desc.length > DESC_LIMIT) {
      blob = trimBlob(blob);
      desc = await encode(blob);
      if (desc.length > DESC_LIMIT) {
        log('focus-sync: state too large even after trimming (' + desc.length + ' chars) — skipping push');
        return false;
      }
    }
    await api('/tasks/' + s.taskId, {
      method: 'POST',
      body: { description: desc },
      keepalive: !!(opts && opts.keepalive)
    });
    return true;
  }

  // Last-resort shrink: drop the oldest stats and any elapsed entries for tasks
  // that aren't in the current session.
  function trimBlob(blob) {
    var keepFrom = todayKey(new Date(Date.now() - 45 * 864e5));
    Object.keys(blob.stats || {}).forEach(function (dev) {
      Object.keys(blob.stats[dev]).forEach(function (day) {
        if (day < keepFrom) delete blob.stats[dev][day];
      });
    });
    var live = {};
    if (blob.session && blob.session.taskIds) blob.session.taskIds.forEach(function (id) { live[id] = 1; });
    Object.keys(blob.elapsed || {}).forEach(function (dev) {
      Object.keys(blob.elapsed[dev]).forEach(function (tid) {
        if (!live[tid]) delete blob.elapsed[dev][tid];
      });
    });
    return blob;
  }

  // ---- merge ---------------------------------------------------------------

  function trimStats(stats) {
    var cutoff = todayKey(new Date(Date.now() - STATS_SYNC_DAYS * 864e5));
    var out = {};
    Object.keys(stats || {}).forEach(function (day) {
      if (day >= cutoff) out[day] = stats[day];
    });
    return out;
  }

  // Fold this device's local state into the remote blob. Accumulators go into
  // this device's own bucket (overwrite — local is authoritative for itself);
  // current-state fields win only if this device's copy is strictly newer.
  function mergeLocalInto(blob, local) {
    var me = getDeviceId();
    blob.v = 1;
    blob.devices = blob.devices || {};
    // lastSeen is quantized to 5-minute steps so an idle read-merge produces
    // byte-identical JSON to the last push. That identity is what lets sync()
    // skip the write: steady-state polling costs one GET, not a GET + POST —
    // which is what makes the app's 15s visible-poll affordable.
    var LASTSEEN_STEP = 5 * 60000;
    blob.devices[me] = { name: deviceName(), lastSeen: Math.floor(Date.now() / LASTSEEN_STEP) * LASTSEEN_STEP };

    blob.stats = blob.stats || {};
    blob.stats[me] = trimStats(local.stats);

    blob.elapsed = blob.elapsed || {};
    blob.elapsed[me] = local.elapsed || {};

    if (local.session && (!blob.session || (local.session.at || 0) > (blob.session.at || 0))) {
      blob.session = {
        at: local.session.at, by: me,
        taskIds: local.session.taskIds, currentIndex: local.session.currentIndex, day: local.session.day
      };
    }
    if (local.goals && (!blob.goals || (local.goals.at || 0) > (blob.goals.at || 0))) {
      blob.goals = { at: local.goals.at, by: me, data: local.goals.data };
    }
    if (local.settings && (!blob.settings || (local.settings.at || 0) > (blob.settings.at || 0))) {
      blob.settings = { at: local.settings.at, by: me, data: local.settings.data };
    }
    return blob;
  }

  // ---- the sync pass ---------------------------------------------------------

  function noteFailure(e) {
    var status = e && typeof e.status === 'number' ? e.status : 0;
    Sync.lastError = e && e.message ? e.message : String(e);
    if (status === 401 || status === 403) {
      // Revoked or replaced token: nothing will work until the user fixes it,
      // so stop the polls hammering Todoist and let the UI say why.
      Sync.authError = true;
      failures = Math.max(failures, 1);
      backoffUntil = Date.now() + BACKOFF_MAX_MS;
    } else {
      failures++;
      backoffUntil = Date.now() + Math.min(BACKOFF_BASE_MS * Math.pow(2, failures - 1), BACKOFF_MAX_MS);
    }
    log('focus-sync: sync failed —', Sync.lastError, '(retry in ' + Math.round((backoffUntil - Date.now()) / 1000) + 's)');
  }

  async function runSync(opts) {
    try {
      var local = cfg.getLocalState();
      var blob;
      // On flush the page has at most a second of life left. Two round trips
      // will not fit, so build on the read we already have when it is fresh.
      var reuse = opts.flush && lastReadAt && (Date.now() - lastReadAt) < FLUSH_REUSE_MS && remote && remote.v;
      if (reuse) {
        blob = remote;
      } else {
        blob = await readRemote();
        lastReadAt = Date.now();
      }
      blob = mergeLocalInto(blob, local);

      var json = JSON.stringify(blob);
      if (json !== lastPushedJSON) {
        var ok = await writeRemote(blob, { keepalive: !!opts.flush });
        if (ok) lastPushedJSON = json;
      }

      remote = blob;
      try { localStorage.setItem(LS_CACHE, json); } catch (e) {}
      Sync.lastError = null;
      Sync.authError = false;
      failures = 0;
      backoffUntil = 0;
      Sync.lastSyncAt = Date.now();
      if (cfg.onRemote) cfg.onRemote(blob);
      return true;
    } catch (e) {
      noteFailure(e);
      return false;
    }
  }

  // ---- public API ----------------------------------------------------------

  var Sync = {
    /** Sum of every OTHER device's stats for a day. Local stats are added by
     *  the caller, which already holds them. */
    remoteStatsFor: function (day) {
      var me = getDeviceId();
      var total = { focusSeconds: 0, pomodoros: 0, tasksCompleted: 0 };
      Object.keys(remote.stats || {}).forEach(function (dev) {
        if (dev === me) return;
        var d = remote.stats[dev][day];
        if (!d) return;
        total.focusSeconds += d.focusSeconds || 0;
        total.pomodoros += d.pomodoros || 0;
        total.tasksCompleted += d.tasksCompleted || 0;
      });
      return total;
    },

    /** Every day key that any other device recorded activity on — needed so
     *  streaks count days you only worked on your phone. */
    remoteActiveDays: function () {
      var me = getDeviceId();
      var days = {};
      Object.keys(remote.stats || {}).forEach(function (dev) {
        if (dev === me) return;
        Object.keys(remote.stats[dev]).forEach(function (day) {
          var d = remote.stats[dev][day];
          if (d && (d.tasksCompleted || d.pomodoros || d.focusSeconds)) days[day] = true;
        });
      });
      return days;
    },

    /** Extra seconds logged against a task on other devices. */
    remoteElapsedFor: function (taskId) {
      var me = getDeviceId();
      var total = 0;
      Object.keys(remote.elapsed || {}).forEach(function (dev) {
        if (dev === me) return;
        total += remote.elapsed[dev][String(taskId)] || 0;
      });
      return total;
    },

    /** The winning session/goals/settings, or null when this device's is newer. */
    remoteSession: function () { return remote.session; },
    remoteGoals: function () { return remote.goals; },
    remoteSettings: function () { return remote.settings; },

    devices: function () { return remote.devices || {}; },
    deviceId: getDeviceId,

    lastError: null,
    lastSyncAt: 0,
    authError: false,   // Todoist rejected the token; polling is paused

    /** Health snapshot for the UI. */
    status: function () {
      return {
        error: Sync.lastError,
        lastSyncAt: Sync.lastSyncAt,
        failures: failures,
        backoffUntil: backoffUntil,
        authError: Sync.authError,
        inFlight: !!inFlightPromise
      };
    },

    init: function (options) {
      cfg = options;
      getDeviceId();
      try {
        var cached = JSON.parse(localStorage.getItem(LS_CACHE) || 'null');
        if (cached && cached.v) remote = cached;   // usable immediately, offline
      } catch (e) {}
      return this;
    },

    /**
     * Read-merge-write. Safe to call often. A call that lands while another
     * is running shares that run's promise AND queues one more pass, so a
     * change made mid-flight is never silently dropped until the next poll.
     *
     * opts.force — ignore the failure backoff (user-initiated actions).
     * opts.flush — the page is going away: reuse a recent read instead of
     *              doing a new one, and send the write with keepalive so it
     *              can outlive the page. Implies force.
     */
    sync: function (opts) {
      opts = opts || {};
      if (!cfg) return Promise.resolve(false);
      if (inFlightPromise) {
        // Keep the strongest request: a flush must not be downgraded.
        if (!rerunOpts || opts.flush) rerunOpts = { force: !!opts.force || !!opts.flush, flush: !!opts.flush };
        return inFlightPromise;
      }
      if (!opts.force && !opts.flush && Date.now() < backoffUntil) return Promise.resolve(false);

      inFlightPromise = runSync(opts).then(function (ok) {
        inFlightPromise = null;
        if (rerunOpts) { var next = rerunOpts; rerunOpts = null; Sync.sync(next); }
        return ok;
      });
      return inFlightPromise;
    },

    /** Coalesce bursts of local changes into one network write. The earliest
     *  requested fire time wins: an urgent schedule (task completed, focus
     *  switched) is never postponed by a routine one landing right after it. */
    schedule: function (delayMs) {
      var fireAt = Date.now() + (delayMs == null ? 8000 : delayMs);
      if (pushTimer && pushDeadline && pushDeadline <= fireAt) return;
      clearTimeout(pushTimer);
      pushDeadline = fireAt;
      pushTimer = setTimeout(function () { pushDeadline = 0; Sync.sync(); }, Math.max(0, fireAt - Date.now()));
    },

    /** Fire immediately because the app is being backgrounded. Reuses a fresh
     *  read and sends the write with keepalive — see sync(). */
    flush: function () {
      clearTimeout(pushTimer);
      pushDeadline = 0;
      return Sync.sync({ flush: true });
    },

    /** The user just saved a token: forget any failure state and try again. */
    resetBackoff: function () {
      failures = 0;
      backoffUntil = 0;
      Sync.authError = false;
      Sync.lastError = null;
    }
  };

  global.FocusSync = Sync;
})(typeof window !== 'undefined' ? window : this);
