// Browser smoke test: boots index.html in headless Chromium against a mocked
// Todoist and checks the reliability/performance behaviours end to end.
//
// Run: npm run test:browser   (needs `npx playwright install chromium` once)
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 8777;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const TASK = { id: '9001', content: 'Write the report', project_id: 'P1', labels: [], due: null, duration: null, checked: false, is_deleted: false };
const PROJECTS = [{ id: 'P1', name: 'Work', color: 'blue' }];

// `state` is mutable so a test can flip the mock mid-page (e.g. outage → recovery).
async function boot(browser, { localStorage: ls, state = {}, items = [TASK] }) {
  state.syncStatus = state.syncStatus || 200;
  state.requests = [];
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://api.todoist.com/**', async r => {
    const u = r.request().url();
    state.requests.push(u);
    if (state.syncStatus !== 200) return r.fulfill({ status: state.syncStatus, contentType: 'application/json', body: '{}' });
    if (u.endsWith('/api/v1/sync')) {
      const body = r.request().postData() || '';
      if (body.includes('"filters"')) return r.fulfill({ json: { filters: [] } });
      return r.fulfill({ json: { full_sync: true, sync_token: 'tok2', items, projects: PROJECTS, user: { id: 'U1' } } });
    }
    if (u.includes('/api/v1/projects')) return r.fulfill({ json: { results: PROJECTS, next_cursor: null } });
    if (u.includes('/api/v1/tasks?project_id')) return r.fulfill({ json: { results: [{ id: 'T1', content: 'focus-state' }], next_cursor: null } });
    if (u.endsWith('/api/v1/tasks/T1')) return r.fulfill({ json: { id: 'T1', description: '' } });
    return r.fulfill({ json: {} });
  });
  await page.addInitScript(vals => { for (const [k, v] of Object.entries(vals)) localStorage.setItem(k, v); }, ls);
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForTimeout(700);
  return { ctx, page, errors, state };
}

const readIdbItemCount = page => page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('focus', 1);
  r.onsuccess = () => {
    try {
      const g = r.result.transaction('kv').objectStore('kv').get('items');
      g.onsuccess = () => res(g.result ? Object.keys(g.result).length : -1);
      g.onerror = () => res(-2);
    } catch (e) { res(-4); }
  };
  r.onerror = () => res(-3);
}));

const base = {
  todoist_api_token: 'test-token',
  focus_session: JSON.stringify({ tasks: [TASK], currentIndex: 0, day: new Date().toISOString().slice(0, 10) }),
  focus_session_at: String(Date.now() - 60000)
};

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    // A. Timer was running when the app died, 100s left → resumes RUNNING at ~1:40.
    {
      const { ctx, page, errors } = await boot(browser, { localStorage: {
        ...base,
        focus_timer_v1: JSON.stringify({ endTime: Date.now() + 100000, initial: 1500, onBreak: false, taskId: '9001', elapsedStamp: Date.now() - 1400000 })
      } });
      const cls = await page.getAttribute('#timerDisplay', 'class');
      const txt = await page.textContent('#timerDisplay');
      assert.ok(cls.includes('running'), 'timer resumed running, classes: ' + cls);
      assert.match(txt.replace(/\s+/g, ''), /^1:(39|40)$/, 'resumed at true remaining time, got ' + txt);
      const elapsed = await page.evaluate(() => JSON.parse(localStorage.getItem('focus_elapsed_v1') || '{}'));
      assert.ok(elapsed['9001'] > 1390 && elapsed['9001'] < 1410, 'time on task credited for the closed stretch: ' + elapsed['9001']);
      const chk = await page.evaluate(() => JSON.parse(localStorage.getItem('focus_timer_v1')));
      assert.ok(chk && chk.endTime > Date.now(), 'checkpoint re-armed for the resumed run');
      assert.deepStrictEqual(errors, [], 'no page errors');
      await ctx.close();
    }

    // B. Timer ran out while the app was closed → banked, fresh countdown armed, toast.
    {
      const { ctx, page, errors } = await boot(browser, { localStorage: {
        ...base,
        focus_timer_v1: JSON.stringify({ endTime: Date.now() - 5000, initial: 600, onBreak: false, taskId: '9001', elapsedStamp: Date.now() - 605000 })
      } });
      const cls = await page.getAttribute('#timerDisplay', 'class');
      assert.ok(!cls.includes('running') && !cls.includes('paused'), 'not running, not mid-countdown: ' + cls);
      const txt = (await page.textContent('#timerDisplay')).replace(/\s+/g, '');
      assert.strictEqual(txt, '25:00', 'fresh countdown armed for the task, got ' + txt);
      const toast = await page.textContent('#toastPill');
      assert.match(toast, /finished while you were away/);
      const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('focus_stats_v1')));
      assert.strictEqual(Object.values(stats)[0].focusSeconds, 600, 'the full countdown was banked');
      assert.strictEqual(await page.evaluate(() => localStorage.getItem('focus_timer_v1')), null, 'checkpoint consumed');
      const elapsed = await page.evaluate(() => JSON.parse(localStorage.getItem('focus_elapsed_v1') || '{}'));
      assert.ok(elapsed['9001'] > 595 && elapsed['9001'] <= 600, 'elapsed credited only up to the end time: ' + elapsed['9001']);
      assert.deepStrictEqual(errors, [], 'no page errors');
      await ctx.close();
    }

    // C. Checkpoint for a DIFFERENT task than the one now in focus → ignored.
    {
      const { ctx, page } = await boot(browser, { localStorage: {
        ...base,
        focus_timer_v1: JSON.stringify({ endTime: Date.now() + 100000, initial: 1500, onBreak: false, taskId: 'someone-else', elapsedStamp: Date.now() })
      } });
      const cls = await page.getAttribute('#timerDisplay', 'class');
      assert.ok(!cls.includes('running'), 'stale checkpoint not applied');
      await ctx.close();
    }

    // D. Plain boot: no errors, empty status line, shared in-flight sync,
    //    projects arrive via the items sync (no REST projects request).
    {
      // The cross-device engine lists projects once on a brand-new device to
      // find its store; pre-seed its cached ids so that lookup is out of the
      // picture and any projects request here would be the removed REST path.
      const { ctx, page, errors, state } = await boot(browser, { localStorage: {
        ...base, focus_sync_ids_v1: JSON.stringify({ projectId: 'P9', taskId: 'T1' })
      } });
      assert.deepStrictEqual(errors, [], 'no page errors on plain boot');
      assert.strictEqual((await page.textContent('#syncStatus')).trim(), '');
      const shared = await page.evaluate(() => { const a = syncNow({ force: true }), b = syncNow(); return a === b; });
      assert.strictEqual(shared, true, 'a mid-flight syncNow shares the running promise');
      const proj = await page.evaluate(() => projects['P1'] && projects['P1'].name);
      assert.strictEqual(proj, 'Work', 'projects populated from the sync response');
      assert.ok(await page.$('#filterSelect option[value="P1"]'), 'project picker lists the synced project');
      assert.strictEqual(state.requests.filter(u => u.includes('/api/v1/projects')).length, 0,
        'no separate projects request at launch; saw: ' + JSON.stringify(state.requests));
      const syncCalls = state.requests.filter(u => u.endsWith('/api/v1/sync')).length;
      assert.ok(syncCalls <= 3, 'launch coalesces into few sync calls, saw ' + JSON.stringify(state.requests));
      await ctx.close();
    }

    // E. Todoist down (500s): failures back off exponentially and the status line speaks up.
    {
      const { ctx, page } = await boot(browser, { localStorage: base, state: { syncStatus: 500 } });
      const r = await page.evaluate(async () => {
        const a = await syncNow({ force: true });
        const skipped = await syncNow();          // inside backoff → false, no request
        const f = _syncFailures, until = _syncBackoffUntil - Date.now();
        renderSyncStatus();
        return { a, skipped, f, until, status: document.getElementById('syncStatus').textContent };
      });
      assert.strictEqual(r.a, false);
      assert.strictEqual(r.skipped, false);
      assert.ok(r.f >= 2, 'failures counted: ' + r.f);
      assert.ok(r.until > 20000, 'backoff grew past the first step: ' + r.until);
      assert.match(r.status, /Can't reach Todoist — retrying in \d+s/);
      await ctx.close();
    }

    // F. Revoked token (401): auth error surfaced, not retried as a full sync storm.
    {
      const { ctx, page } = await boot(browser, { localStorage: base, state: { syncStatus: 401 } });
      const r = await page.evaluate(async () => {
        await syncNow({ force: true });
        renderSyncStatus();
        return { auth: _authError, status: document.getElementById('syncStatus').textContent, warn: document.getElementById('syncStatus').classList.contains('warn') };
      });
      assert.strictEqual(r.auth, true);
      assert.match(r.status, /rejected your API token/);
      assert.strictEqual(r.warn, true);
      await ctx.close();
    }

    // G. Item store: legacy localStorage copy is read offline, then migrated to
    //    IndexedDB on the first successful sync.
    {
      const TASK2 = { ...TASK, id: '9002', content: 'Second task' };
      const { ctx, page, state } = await boot(browser, {
        localStorage: { ...base, todoist_items_v1: JSON.stringify({ 9001: TASK, 9002: TASK2 }), todoist_sync_token_v1: 'legacy' },
        state: { syncStatus: 500 }
      });
      assert.strictEqual(await page.evaluate(() => allTasks.length), 2, 'legacy store readable while offline');
      state.syncStatus = 200;
      await page.evaluate(() => syncNow({ force: true }));
      await page.waitForTimeout(400);
      assert.strictEqual(await readIdbItemCount(page), 1, 'items now live in IndexedDB');
      assert.strictEqual(await page.evaluate(() => localStorage.getItem('todoist_items_v1')), null, 'legacy copy removed');
      assert.strictEqual(await page.evaluate(() => localStorage.getItem('todoist_sync_token_v1')), 'tok2', 'token written after items');
      await ctx.close();
      // Relaunch reads it back from IndexedDB with no network.
      const second = await boot(browser, { localStorage: base, state: { syncStatus: 500 } });
      // (fresh context = fresh IndexedDB, so seed it via one good sync first)
      second.state.syncStatus = 200;
      await second.page.evaluate(() => syncNow({ force: true }));
      await second.page.waitForTimeout(300);
      second.state.syncStatus = 500;
      await second.page.reload();
      await second.page.waitForTimeout(500);
      assert.strictEqual(await second.page.evaluate(() => allTasks.length), 1, 'store restored from IndexedDB on relaunch');
      await second.ctx.close();
    }

    // H. Search caps its rendering and still adds via the delegated click.
    {
      const many = [TASK];
      for (let i = 0; i < 299; i++) many.push({ ...TASK, id: String(10000 + i), content: `Task ${i} alpha` });
      const { ctx, page } = await boot(browser, { localStorage: base, items: many });
      await page.click('#reorderBtn');
      await page.fill('#taskSearchInput', 'alpha');
      await page.waitForTimeout(500);
      const rows = await page.$$('.search-result-item');
      assert.strictEqual(rows.length, 150, 'results capped, got ' + rows.length);
      assert.match(await page.textContent('#searchResults'), /Showing 150 of 299/);
      await page.click('.search-result-item:not(.in-session)');
      assert.strictEqual(await page.evaluate(() => tasks.length), 2, 'delegated click added the task');
      await ctx.close();
    }

    // I. Closing Manage Tasks lands on the first task — unless a timer is running.
    {
      const T2 = { ...TASK, id: '9002', content: 'Second' }, T3 = { ...TASK, id: '9003', content: 'Third' };
      const { ctx, page } = await boot(browser, {
        localStorage: { ...base, focus_session: JSON.stringify({ tasks: [TASK, T2, T3], currentIndex: 2, day: new Date().toISOString().slice(0, 10) }) },
        items: [TASK, T2, T3]
      });
      assert.strictEqual(await page.evaluate(() => currentIndex), 2, 'starts focused on the third task');
      await page.click('#reorderBtn');
      await page.click('#closeTaskOrder');
      await page.waitForTimeout(100);
      assert.strictEqual(await page.evaluate(() => currentIndex), 0, 'idle timer: closing the list jumps to the first task');
      assert.match(await page.textContent('#taskCounter'), /^1 of 3/);
      // Now focus the third task again, start its timer, and repeat: focus must stay.
      await page.evaluate(() => switchFocusedTask(2));
      await page.click('#timerStartBtn');
      assert.strictEqual(await page.evaluate(() => timerRunning), true);
      await page.click('#reorderBtn');
      await page.click('#closeTaskOrder');
      await page.waitForTimeout(100);
      assert.strictEqual(await page.evaluate(() => currentIndex), 2, 'running timer: closing the list keeps the current task');
      assert.strictEqual(await page.evaluate(() => timerRunning), true, 'and the timer is still running');
      await ctx.close();
    }

    console.log('all smoke tests passed');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
