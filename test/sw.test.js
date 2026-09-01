// Unit test of sw.js's shell fetch strategy under mocked Cache/fetch APIs.
// Run: node sw.test.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function mkRes(body, ok = true, status = 200) {
  return { ok, status, body, clone() { return mkRes(body, ok, status); } };
}

// ---- mocks -----------------------------------------------------------------
const cacheStore = new Map();
// The real Cache API resolves relative keys against the worker's URL.
const key = req => new URL(typeof req === 'string' ? req : req.url, 'https://example.test/sw.js').href;
const cache = {
  async match(req) { return cacheStore.get(key(req)) || undefined; },
  async put(req, res) { cacheStore.set(key(req), res); },
  async add() {}
};
const listeners = {};
let networkBehaviour = 'ok'; // 'ok' | 'slow' | 'down' | 'error500'
let slowResolver = null;

const sandbox = {
  console,
  setTimeout, clearTimeout,
  URL,
  Promise,
  Response: { error: () => ({ type: 'error', ok: false, status: 0 }) },
  caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: (r) => cache.match(r) },
  self: {
    location: { origin: 'https://example.test' },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    registration: {}
  },
  fetch: (req) => {
    const url = typeof req === 'string' ? req : req.url;
    if (networkBehaviour === 'down') return Promise.reject(new TypeError('Failed to fetch'));
    if (networkBehaviour === 'error500') return Promise.resolve(mkRes('server error', false, 500));
    if (networkBehaviour === 'slow') return new Promise(r => { slowResolver = () => r(mkRes('FRESH ' + url)); });
    return Promise.resolve(mkRes('FRESH ' + url));
  }
};
vm.createContext(sandbox);
// Shorten the deadline so the test is quick (it is a const in the worker).
const src = fs.readFileSync(require('path').join(__dirname, '..', 'sw.js'), 'utf8').replace('SHELL_NETWORK_TIMEOUT_MS = 2500', 'SHELL_NETWORK_TIMEOUT_MS = 50');
assert.ok(src.includes('SHELL_NETWORK_TIMEOUT_MS = 50'), 'deadline constant found');
vm.runInContext(src, sandbox);

function dispatchFetch(url, mode = 'no-cors') {
  let responded = null; const waits = [];
  const event = {
    request: { url, method: 'GET', mode },
    respondWith: p => { responded = Promise.resolve(p); },
    waitUntil: p => waits.push(p)
  };
  listeners.fetch(event);
  return { responded, waits };
}

(async () => {
  const shellUrl = 'https://example.test/index.html';

  // 1. Cold: nothing cached, network ok → served from network and cached.
  networkBehaviour = 'ok';
  let r = await dispatchFetch(shellUrl).responded;
  assert.strictEqual(r.body, 'FRESH ' + shellUrl);
  await sleep(5);
  assert.ok(cacheStore.has(shellUrl), 'network response was cached');

  // 2. Warm cache, slow network → cached copy after the deadline, not a hang.
  networkBehaviour = 'slow';
  cacheStore.set(shellUrl, mkRes('CACHED'));
  const t0 = Date.now();
  r = await dispatchFetch(shellUrl).responded;
  const took = Date.now() - t0;
  assert.strictEqual(r.body, 'CACHED', 'slow network falls back to cache');
  assert.ok(took >= 45 && took < 500, 'fell back at the deadline, took ' + took + 'ms');
  // The late network response still refreshes the cache for next launch.
  slowResolver(); await sleep(5);
  assert.strictEqual(cacheStore.get(shellUrl).body, 'FRESH ' + shellUrl, 'late response refreshed cache');

  // 3. Warm cache, fast network → fresh build wins.
  networkBehaviour = 'ok';
  cacheStore.set(shellUrl, mkRes('CACHED'));
  r = await dispatchFetch(shellUrl).responded;
  assert.strictEqual(r.body, 'FRESH ' + shellUrl, 'fast network is preferred');

  // 4. Warm cache, offline → cached immediately.
  networkBehaviour = 'down';
  cacheStore.set(shellUrl, mkRes('CACHED'));
  r = await dispatchFetch(shellUrl).responded;
  assert.strictEqual(r.body, 'CACHED', 'offline serves cache');

  // 5. Warm cache, server 500 → cached rather than the error page.
  networkBehaviour = 'error500';
  r = await dispatchFetch(shellUrl).responded;
  assert.strictEqual(r.body, 'CACHED', '5xx falls back to cache');

  // 6. Offline navigation to an uncached URL (notification tap) → shell page.
  networkBehaviour = 'down';
  cacheStore.set('https://example.test/index.html', mkRes('SHELL'));
  r = await dispatchFetch('https://example.test/?intent=next', 'navigate').responded;
  assert.strictEqual(r.body, 'SHELL', 'uncached navigation boots from the shell');

  // 7. Offline request for an uncached SCRIPT → honest error, not HTML.
  r = await dispatchFetch('https://example.test/missing.js', 'no-cors').responded;
  assert.strictEqual(r.type, 'error', 'a script is never answered with index.html');

  // 8. API traffic is never intercepted.
  const ev = dispatchFetch('https://api.todoist.com/api/v1/sync');
  assert.strictEqual(ev.responded, null, 'API request passes straight through');

  // 9. Cross-origin miss while offline → error response, not undefined.
  networkBehaviour = 'down';
  r = await dispatchFetch('https://fonts.googleapis.com/css2?family=X').responded;
  assert.strictEqual(r.type, 'error');

  console.log('all sw tests passed');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
