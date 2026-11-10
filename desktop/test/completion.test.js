const { test } = require('node:test');
const assert = require('node:assert/strict');
const Completion = require('../../todoist-completion.js');

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}
function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}
function commandFrom(options) {
  return JSON.parse(new URLSearchParams(options.body).get('commands'))[0];
}
function acknowledged(options) {
  return response({ sync_status: { [commandFrom(options).uuid]: 'ok' } });
}
function client(fetch, extra = {}) {
  return Completion.create({ fetch, storage: memoryStorage(), uuid: () => 'fixture-command-uuid', ...extra });
}

test('persists a command before submitting and requires its exact acknowledgment', async () => {
  const storage = memoryStorage();
  const instance = client(async (url, options) => {
    assert.equal(url, 'https://api.todoist.com/api/v1/sync');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.ok(options.signal);
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('resource_types'), '[]');
    assert.equal(body.get('sync_token'), '*');
    assert.deepEqual(commandFrom(options), { type: 'item_close', uuid: 'fixture-command-uuid', args: { id: 'task-a' } });
    assert.equal(storage.values.size, 1);
    assert.deepEqual(JSON.parse([...storage.values.values()][0]), { id: 'task-a', uuid: 'fixture-command-uuid' });
    return acknowledged(options);
  }, { storage });
  assert.equal(await instance.close({ id: 'task-a' }, 'test-token'), 'task-a');
  assert.equal(storage.values.size, 0);
});

test('uses a current v2_id for a legacy numeric task without guessing', async () => {
  const instance = client(async (url, options) => {
    assert.ok(url.endsWith('/sync'));
    assert.equal(commandFrom(options).args.id, 'current-id');
    return acknowledged(options);
  });
  assert.equal(await instance.close({ id: 123, v2_id: 'current-id' }, 'test-token'), 'current-id');
});

test('resolves numeric task IDs through the mapping endpoint', async () => {
  const calls = [];
  const instance = client(async (url, options) => {
    calls.push(url);
    if (options.method === 'GET') return response([{ old_id: '123', new_id: 'current-id' }]);
    assert.equal(commandFrom(options).args.id, 'current-id');
    return acknowledged(options);
  });
  assert.equal(await instance.close({ id: '123' }, 'test-token'), 'current-id');
  assert.deepEqual(calls, ['https://api.todoist.com/api/v1/id_mappings/tasks/123', 'https://api.todoist.com/api/v1/sync']);
});

test('does not send a completion when a legacy mapping is absent or invalid', async () => {
  for (const mappings of [[], [{ old_id: '999', new_id: 'other' }], [{ old_id: '123', new_id: '456' }], {}]) {
    let calls = 0;
    const instance = client(async (_, options) => { calls++; assert.equal(options.method, 'GET'); return response(mappings); });
    await assert.rejects(instance.close({ id: '123' }, 'test-token'), error => ['protocol', 'not_found'].includes(error.code));
    assert.equal(calls, 1);
  }
});

test('HTTP 200 missing, wrong, or error sync status is not successful completion', async () => {
  for (const data of [{}, { sync_status: {} }, { sync_status: { unrelated: 'ok' } }, { sync_status: { 'fixture-command-uuid': { error_code: 22 } } }, { sync_status: { 'fixture-command-uuid': null } }]) {
    const storage = memoryStorage();
    const instance = client(async () => response(data), { storage });
    await assert.rejects(instance.close({ id: 'task-a' }, 'test-token'), { code: 'protocol' });
    assert.equal(storage.values.size, 1);
  }
});

test('HTTP and command errors produce safe actionable categories', async () => {
  for (const [status, code] of [[401, 'auth'], [403, 'permission'], [404, 'not_found'], [429, 'rate_limit'], [503, 'remote']]) {
    for (const commandError of [false, true]) {
      const instance = client(async () => commandError
        ? response({ sync_status: { 'fixture-command-uuid': { http_code: status, error: 'secret server text' } } })
        : response(null, status));
      await assert.rejects(instance.close({ id: 'task-a' }, 'test-token'), error => {
        assert.equal(error.code, code);
        assert.doesNotMatch(Completion.messageForError(error), /secret|test-token/);
        return true;
      });
    }
  }
});

test('a timeout persists the same UUID across reload for a safe recurring-task retry', async () => {
  const storage = memoryStorage();
  let savedCommand, signal;
  const stalled = client(async (_, options) => {
    savedCommand = commandFrom(options); signal = options.signal;
    return new Promise(() => {});
  }, { storage, timeoutMs: 5 });
  await assert.rejects(stalled.close({ id: 'recurring-task' }, 'test-token'), { code: 'timeout' });
  assert.equal(signal.aborted, true);
  assert.equal(storage.values.size, 1);
  const reloaded = client(async (_, options) => {
    assert.deepEqual(commandFrom(options), savedCommand);
    return acknowledged(options);
  }, { storage, uuid: () => { throw new Error('must reuse the original command'); } });
  assert.equal(await reloaded.close({ id: 'recurring-task' }, 'test-token'), 'recurring-task');
  assert.equal(storage.values.size, 0);
});

test('timeout includes stalled JSON parsing and always clears its deadline', async () => {
  let cleared = 0;
  const instance = client(async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }), {
    timeoutMs: 5,
    clearTimeout: timer => { cleared++; clearTimeout(timer); }
  });
  await assert.rejects(instance.close({ id: 'task-a' }, 'test-token'), { code: 'timeout' });
  assert.equal(cleared, 1);
});

test('concurrent calls for the same canonical task send one command', async () => {
  let release, calls = 0;
  const instance = client((_, options) => { calls++; return new Promise(resolve => { release = () => resolve(acknowledged(options)); }); });
  const first = instance.close({ id: 'current-task' }, 'test-token');
  const second = instance.close({ id: '123', v2_id: 'current-task' }, 'test-token');
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['current-task', 'current-task']);
});

test('network failures and malformed JSON retain the pending request', async () => {
  for (const [fetch, code] of [
    [async () => { throw new Error('secret network detail'); }, 'offline'],
    [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad JSON'); } }), 'protocol']
  ]) {
    const storage = memoryStorage();
    const instance = client(fetch, { storage });
    await assert.rejects(instance.close({ id: 'task-a' }, 'test-token'), { code });
    assert.equal(storage.values.size, 1);
  }
});

test('missing credentials and failed durable storage prevent a network mutation', async () => {
  let calls = 0;
  const fetch = async () => { calls++; throw new Error('unexpected request'); };
  await assert.rejects(client(fetch).close({ id: 'task-a' }, ''), { code: 'auth' });
  for (const storage of [
    { getItem: () => null, setItem: () => { throw new Error('quota'); } },
    { getItem: () => null, setItem: () => {} },
    { getItem: () => 'broken JSON' }
  ]) {
    await assert.rejects(client(fetch, { storage }).close({ id: 'task-a' }, 'test-token'), { code: 'storage' });
  }
  assert.equal(calls, 0);
});

test('a successful later recurring occurrence receives a new command UUID', async () => {
  let count = 0;
  const uuids = [];
  const instance = client(async (_, options) => { uuids.push(commandFrom(options).uuid); return acknowledged(options); }, { uuid: () => `command-${++count}` });
  await instance.close({ id: 'recurring-task' }, 'test-token');
  await instance.close({ id: 'recurring-task' }, 'test-token');
  assert.deepEqual(uuids, ['command-1', 'command-2']);
});

test('acknowledged success survives failed removal and a reload can complete the next occurrence', async () => {
  const storage = memoryStorage();
  storage.removeItem = () => { throw new Error('storage removal unavailable'); };
  const commands = [];
  const fetch = async (_, options) => { commands.push(commandFrom(options).uuid); return acknowledged(options); };
  const first = client(fetch, { storage, uuid: () => 'first-occurrence' });
  assert.equal(await first.close({ id: 'recurring-task' }, 'test-token'), 'recurring-task');
  assert.equal(JSON.parse([...storage.values.values()][0]).acknowledged, true);
  const reloaded = client(fetch, { storage, uuid: () => 'next-occurrence' });
  assert.equal(await reloaded.close({ id: 'recurring-task' }, 'test-token'), 'recurring-task');
  assert.deepEqual(commands, ['first-occurrence', 'next-occurrence']);
});

test('all local cleanup failures after acknowledgment preserve success and an in-memory confirmation', async () => {
  const storage = memoryStorage();
  const originalSet = storage.setItem;
  let failCleanup = false, uuid = 0;
  storage.setItem = (key, value) => {
    if (failCleanup) throw new Error('storage write unavailable');
    originalSet(key, value);
  };
  storage.removeItem = () => { throw new Error('storage removal unavailable'); };
  const commands = [];
  const instance = client(async (_, options) => {
    commands.push(commandFrom(options).uuid); failCleanup = true;
    return acknowledged(options);
  }, { storage, uuid: () => `occurrence-${++uuid}` });
  assert.equal(await instance.close({ id: 'recurring-task' }, 'test-token'), 'recurring-task');
  failCleanup = false;
  assert.equal(await instance.close({ id: 'recurring-task' }, 'test-token'), 'recurring-task');
  assert.deepEqual(commands, ['occurrence-1', 'occurrence-2']);
});
