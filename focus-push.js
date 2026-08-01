/* ---------------------------------------------------------------------------
 * focus-push.js — lock-screen alerts for the iOS/web build.
 *
 * THE PROBLEM: iOS gives a web app no way to schedule a notification that fires
 * while the app is closed. The Notification Triggers API doesn't exist in
 * Safari, and JS timers are frozen the moment you leave the app.
 *
 * THE FIX: an installed iOS PWA *does* receive Web Push, which lands on the
 * lock screen like a native alert. So when a timer starts we tell a tiny
 * scheduler Worker "push me at this exact millisecond", and it does.
 *
 * Requirements, all of which iOS enforces:
 *   - The app must be installed to the Home Screen. Push does not work in a
 *     Safari tab; permission requests there will fail.
 *   - iOS 16.4 or newer.
 *   - Permission must be requested from inside a real user gesture.
 *
 * Inert under Electron — the desktop app is never asleep in the way a phone is,
 * and shows its notifications directly.
 * ------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var LS_CFG = 'focus_push_cfg_v1';
  var LS_CLIENT = 'focus_push_client_v1';

  var cfg = { url: '', key: '' };
  var subscription = null;
  var clientId = null;
  var vapidPublicKey = null;

  function loadCfg() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_CFG) || 'null');
      if (d && typeof d === 'object') cfg = { url: d.url || '', key: d.key || '' };
    } catch (e) { /* keep defaults */ }
    return cfg;
  }

  function saveCfg(next) {
    cfg = { url: (next.url || '').replace(/\/+$/, ''), key: next.key || '' };
    try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (e) {}
    return cfg;
  }

  function getClientId() {
    if (clientId) return clientId;
    try { clientId = localStorage.getItem(LS_CLIENT); } catch (e) {}
    if (!clientId) {
      clientId = 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem(LS_CLIENT, clientId); } catch (e) {}
    }
    return clientId;
  }

  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function post(path, body) {
    if (!cfg.url) throw new Error('push server not configured');
    var headers = { 'Content-Type': 'application/json' };
    if (cfg.key) headers['X-Focus-Key'] = cfg.key;
    var res = await fetch(cfg.url + path, {
      method: 'POST', headers: headers,
      body: JSON.stringify(Object.assign({ clientId: getClientId() }, body))
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  var Push = {
    /** Browser capability only — says nothing about permission or install state. */
    isSupported: function () {
      return typeof window !== 'undefined'
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && typeof Notification !== 'undefined';
    },

    /** True when running as an installed Home Screen app (required on iOS). */
    isInstalled: function () {
      return !!(global.navigator && navigator.standalone)
        || (global.matchMedia && matchMedia('(display-mode: standalone)').matches);
    },

    isIOS: function () {
      var ua = (global.navigator && navigator.userAgent) || '';
      return /iPhone|iPad|iPod/.test(ua);
    },

    permission: function () {
      return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    },

    config: function () { return Object.assign({}, cfg); },
    setConfig: saveCfg,
    isConfigured: function () { return !!cfg.url; },
    isActive: function () { return !!subscription && !!cfg.url && Push.permission() === 'granted'; },

    init: function () {
      loadCfg();
      getClientId();
      // Reattach to an existing subscription so a reload doesn't need permission again.
      if (Push.isSupported() && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription();
        }).then(function (sub) {
          if (sub) subscription = sub;
        }).catch(function () {});
      }
      return Push;
    },

    /**
     * Ask for permission and subscribe. MUST be called from a user gesture.
     * Returns { ok, reason } so the caller can explain a refusal precisely
     * rather than showing a generic failure.
     */
    enable: async function () {
      if (!Push.isSupported()) return { ok: false, reason: 'unsupported' };
      if (!cfg.url) return { ok: false, reason: 'not-configured' };
      // The single most common iOS failure: trying this from a Safari tab.
      if (Push.isIOS() && !Push.isInstalled()) return { ok: false, reason: 'not-installed' };

      var perm = Notification.permission;
      if (perm === 'default') {
        try { perm = await Notification.requestPermission(); }
        catch (e) { return { ok: false, reason: 'permission-error' }; }
      }
      if (perm !== 'granted') return { ok: false, reason: 'denied' };

      try {
        if (!vapidPublicKey) {
          var r = await fetch(cfg.url + '/key');
          var d = await r.json();
          vapidPublicKey = d.publicKey;
        }
        if (!vapidPublicKey) return { ok: false, reason: 'no-server-key' };

        var reg = await navigator.serviceWorker.ready;
        subscription = await reg.pushManager.getSubscription();
        if (!subscription) {
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,   // required; iOS enforces it strictly
            applicationServerKey: b64urlToBytes(vapidPublicKey)
          });
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'subscribe-failed', detail: e && e.message };
      }
    },

    disable: async function () {
      try {
        await Push.cancel();
        if (subscription) { await subscription.unsubscribe(); subscription = null; }
      } catch (e) { /* best effort */ }
    },

    /**
     * Ask the server to push at `fireAtMs`. Replaces any pending alert for this
     * device, so restarting a timer never leaves an orphaned alarm behind.
     */
    schedule: async function (fireAtMs, payload) {
      if (!Push.isActive()) return false;
      try {
        await post('/schedule', {
          subscription: subscription.toJSON(),
          fireAt: Math.round(fireAtMs),
          payload: payload || {}
        });
        return true;
      } catch (e) {
        console.warn('focus-push: schedule failed —', e && e.message);
        return false;
      }
    },

    cancel: async function () {
      if (!cfg.url || !subscription) return false;
      try { await post('/cancel', {}); return true; }
      catch (e) { return false; }
    },

    /** Fire one immediately, to prove the whole chain works after setup. */
    test: async function () {
      if (!Push.isActive()) return { ok: false, reason: 'not-active' };
      try {
        var r = await post('/test', {
          subscription: subscription.toJSON(),
          payload: { title: 'Focus', body: 'Lock screen alerts are working.', intent: 'open' }
        });
        return { ok: !!r.ok, status: r.status, detail: r.detail };
      } catch (e) {
        return { ok: false, reason: e && e.message };
      }
    }
  };

  global.FocusPush = Push;
})(typeof window !== 'undefined' ? window : this);
