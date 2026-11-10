/* Todoist task completion with durable command IDs for safe retries. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FocusTodoistCompletion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var API = 'https://api.todoist.com/api/v1';
  var STORAGE_PREFIX = 'focus_todoist_completion_v1:';

  function failure(code) {
    var error = new Error(messageForError({ code: code }));
    error.name = 'TodoistCompletionError';
    error.code = code;
    return error;
  }

  function messageForError(error) {
    var messages = {
      auth: 'Reconnect Todoist in Settings, then try completing the task again.',
      permission: 'Todoist denied permission to complete this task. Check your access in Todoist.',
      not_found: 'This task could not be found in Todoist. Refresh your tasks and try again.',
      rate_limit: 'Todoist is receiving too many requests. Wait a minute, then try again.',
      offline: 'Could not reach Todoist. Check your connection, then try again.',
      timeout: 'Todoist did not respond in time. Try again; Focus will safely reuse this completion request.',
      protocol: 'Todoist did not confirm completion. Refresh your tasks and try again.',
      storage: 'Focus could not save the completion request. Restart Focus and try again.',
      remote: 'Todoist could not complete this task. Wait a moment, then try again.'
    };
    return messages[error && error.code] || messages.remote;
  }

  function httpFailure(status) {
    return failure(({ 401: 'auth', 403: 'permission', 404: 'not_found', 429: 'rate_limit' })[status] || 'remote');
  }

  function validId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function create(options) {
    options = options || {};
    var requestFetch = options.fetch || function () { return root.fetch.apply(root, arguments); };
    var storage = options.storage || root.localStorage;
    var makeUuid = options.uuid || function () { return root.crypto.randomUUID(); };
    var timeoutMs = options.timeoutMs == null ? 15000 : options.timeoutMs;
    var setTimer = options.setTimeout || root.setTimeout.bind(root);
    var clearTimer = options.clearTimeout || root.clearTimeout.bind(root);
    var Abort = options.AbortController || root.AbortController;
    var active = new Map();
    var confirmed = new Map();

    // The deadline covers response parsing too. Abort alone need not interrupt
    // an already-returned response body, so the deadline also rejects the race.
    async function request(path, token, body) {
      var controller = new Abort();
      var timer;
      var deadline = new Promise(function (_, reject) {
        timer = setTimer(function () {
          reject(failure('timeout'));
          controller.abort();
        }, timeoutMs);
      });
      var operation = (async function () {
        var response;
        try {
          var headers = { Authorization: 'Bearer ' + token };
          if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
          response = await requestFetch(API + path, {
            method: body ? 'POST' : 'GET', headers: headers,
            body: body ? body.toString() : undefined, signal: controller.signal
          });
        } catch (error) {
          throw failure(controller.signal.aborted || (error && error.name === 'TimeoutError') ? 'timeout' : 'offline');
        }
        if (!response || typeof response.ok !== 'boolean') throw failure('protocol');
        if (!response.ok) throw httpFailure(response.status);
        try { return await response.json(); }
        catch (_) { throw failure(controller.signal.aborted ? 'timeout' : 'protocol'); }
      })();
      try { return await Promise.race([operation, deadline]); }
      finally { clearTimer(timer); }
    }

    async function resolveId(task, token) {
      var id = task && task.id != null ? String(task.id) : '';
      if (!validId(id)) throw failure('protocol');
      if (!/^\d+$/.test(id)) return id;
      var alias = task.v2_id == null ? '' : String(task.v2_id);
      if (validId(alias) && !/^\d+$/.test(alias)) return alias;
      var mappings = await request('/id_mappings/tasks/' + encodeURIComponent(id), token);
      if (!Array.isArray(mappings)) throw failure('protocol');
      var matches = mappings.filter(function (entry) {
        return entry && String(entry.old_id) === id;
      });
      if (matches.length !== 1) throw failure(matches.length ? 'protocol' : 'not_found');
      var mapped = String(matches[0].new_id || '');
      if (!validId(mapped) || /^\d+$/.test(mapped)) throw failure('protocol');
      return mapped;
    }

    function pendingCommand(id) {
      var key = STORAGE_PREFIX + encodeURIComponent(id);
      try {
        var raw = storage.getItem(key);
        if (raw != null) {
          var saved = JSON.parse(raw);
          if (!saved || saved.id !== id || typeof saved.uuid !== 'string' || !saved.uuid) throw new Error('invalid record');
          if (saved.acknowledged !== true && confirmed.get(id) !== saved.uuid) {
            return { key: key, id: id, uuid: saved.uuid };
          }
        }
        var uuid = makeUuid();
        if (typeof uuid !== 'string' || !uuid) throw new Error('invalid command ID');
        var value = JSON.stringify({ id: id, uuid: uuid });
        storage.setItem(key, value);
        // Fail closed if storage writes are silently discarded.
        if (storage.getItem(key) !== value) throw new Error('request not saved');
        return { key: key, id: id, uuid: uuid };
      } catch (_) { throw failure('storage'); }
    }

    async function sendClose(id, token) {
      var command = pendingCommand(id);
      var body = new URLSearchParams({
        sync_token: '*', resource_types: '[]',
        commands: JSON.stringify([{ type: 'item_close', uuid: command.uuid, args: { id: id } }])
      });
      var result = await request('/sync', token, body);
      var statuses = result && result.sync_status;
      if (!statuses || !Object.prototype.hasOwnProperty.call(statuses, command.uuid)) throw failure('protocol');
      var status = statuses[command.uuid];
      if (status !== 'ok') {
        if (status && typeof status === 'object' && Number.isInteger(status.http_code)) throw httpFailure(status.http_code);
        throw failure('protocol');
      }
      // Remote acknowledgment is final even if local cleanup fails. Mark the
      // saved record first, so a failed removal cannot suppress a later repeat.
      // The memory marker also covers a simultaneous storage write failure.
      confirmed.set(id, command.uuid);
      try { storage.setItem(command.key, JSON.stringify({ id: id, uuid: command.uuid, acknowledged: true })); }
      catch (_) { /* already confirmed by Todoist */ }
      try {
        storage.removeItem(command.key);
        if (storage.getItem(command.key) == null) confirmed.delete(id);
      } catch (_) { /* never turn acknowledged success into a remote failure */ }
      return id;
    }

    async function close(task, token) {
      if (typeof token !== 'string' || !token.trim()) throw failure('auth');
      var id = await resolveId(task, token);
      // Canonical ID keys also coalesce legacy and current representations.
      if (active.has(id)) return active.get(id);
      var operation = sendClose(id, token);
      active.set(id, operation);
      try { return await operation; }
      finally { if (active.get(id) === operation) active.delete(id); }
    }

    return { close: close };
  }

  return { create: create, messageForError: messageForError };
});
