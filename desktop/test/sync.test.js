const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../focus-sync.js'), 'utf8');
function harness() {
  const store = new Map([
    ['focus_device_id_v1', 'test-device'],
    ['focus_sync_ids_v1', JSON.stringify({ projectId: 'p', taskId: 't' })]
  ]);
  const h = { blob: { v: 1, devices: {}, stats: {}, elapsed: {} }, writes: 0, timers: [], local: { stats: {}, elapsed: {}, session: { at: 1, taskIds: ['a'], currentIndex: 0 } } };
  const context = vm.createContext({
    URL, AbortSignal, console, navigator: { userAgent: 'test' },
    localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) },
    setTimeout: f => { h.timers.push(f); return h.timers.length; }, clearTimeout() {},
    fetch: async (url, opts) => {
      assert.ok(opts.signal, 'network requests must have a timeout');
      if (opts.method === 'POST') {
        h.writes++;
        h.blob = JSON.parse(JSON.parse(opts.body).description.slice(4));
      } else if (h.beforeRead) { await h.beforeRead(); }
      return { ok: true, status: 200, json: async () => ({ description: 'FS0:' + JSON.stringify(h.blob) }) };
    }
  });
  vm.runInContext(source, context);
  h.sync = context.FocusSync.init({ getToken: () => 'test-token', getLocalState: () => h.local });
  return h;
}
test('unchanged remote state does not cause repeated writes', async () => {
  const h = harness();
  assert.equal(await h.sync.sync(), true);
  assert.equal(h.writes, 1);
  assert.equal(await h.sync.sync(), true);
  assert.equal(h.writes, 1);
});
test('local edits during the remote read are included', async () => {
  const h = harness();
  h.beforeRead = () => { h.local = { ...h.local, session: { at: 2, taskIds: ['new'], currentIndex: 0 } }; };
  await h.sync.sync();
  assert.deepEqual(h.blob.session.taskIds, ['new']);
});
test('a concurrent flush queues a follow-up instead of losing the request', async () => {
  const h = harness();
  let release;
  h.beforeRead = () => new Promise(resolve => { release = resolve; });
  const first = h.sync.sync();
  await new Promise(setImmediate);
  assert.equal(await h.sync.flush(), false);
  release();
  await first;
  assert.equal(h.timers.length, 1);
});
test('repairs a remote bucket changed since the last successful push', async () => {
  const h = harness();
  await h.sync.sync();
  h.blob.session = { at: 0, taskIds: ['old'] };
  await h.sync.sync();
  assert.equal(h.writes, 2);
  assert.deepEqual(h.blob.session.taskIds, ['a']);
});
test('a failed read releases the lock and allows a retry', async () => {
  const h = harness();
  h.beforeRead = () => { throw new Error('offline'); };
  assert.equal(await h.sync.sync(), false);
  h.beforeRead = null;
  assert.equal(await h.sync.sync(), true);
});
