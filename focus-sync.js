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

  var cfg = null;      // { getToken, getLocalState, onRemote, log }
  var ids = null;      // { projectId, taskId }
  var deviceId = null;
  var remote = emptyBlob();
  var pushTimer = null;
  var pushDeadline = 0;  // wall-clock ms the pending pushTimer fires at
  var inFlight = false;
  var pendingSync = false;

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

  async function api(path, opts) {
    var token = await cfg.getToken();
    if (!token) throw new Error('no token');
    opts = opts || {};
    var headers = { 'Authorization': 'Bearer ' + token };
    if (opts.body) headers['Content-Type'] = 'application/json';
    var res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' on ' + path);
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
    var blob = await decode(task && task.description);
    return blob || emptyBlob();
  }

  async function writeRemote(blob) {
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
    await api('/tasks/' + s.taskId, { method: 'POST', body: { description: desc } });
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

    init: function (options) {
      cfg = options;
      getDeviceId();
      try {
        var cached = JSON.parse(localStorage.getItem(LS_CACHE) || 'null');
        if (cached && cached.v) remote = cached;   // usable immediately, offline
      } catch (e) {}
      return this;
    },

    /** Read-merge-write. Safe to call often; collapses concurrent callers. */
    sync: async function () {
      if (inFlight) { pendingSync = true; return false; }
      if (!cfg) return false;
      inFlight = true;
      try {
        var blob = await readRemote();
        var remoteJSON = JSON.stringify(blob);
        var local = cfg.getLocalState();
        blob = mergeLocalInto(blob, local);

        var json = JSON.stringify(blob);
        if (json !== remoteJSON) {
          var ok = await writeRemote(blob);
          if (!ok) throw new Error('Sync state is too large to upload');
          json = JSON.stringify(blob);
        }

        remote = blob;
        try { localStorage.setItem(LS_CACHE, json); } catch (e) {}
        Sync.lastError = null;
        Sync.lastSyncAt = Date.now();
        if (cfg.onRemote) cfg.onRemote(blob);
        return true;
      } catch (e) {
        Sync.lastError = e && e.message ? e.message : String(e);
        log('focus-sync: sync failed —', Sync.lastError);
        return false;
      } finally {
        inFlight = false;
        if (pendingSync) { pendingSync = false; Sync.schedule(0); }
      }
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

    /** Fire immediately, e.g. when the app is being backgrounded. */
    flush: function () {
      clearTimeout(pushTimer);
      pushDeadline = 0;
      return Sync.sync();
    }
  };

  global.FocusSync = Sync;
})(typeof window !== 'undefined' ? window : this);
