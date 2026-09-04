// Runs the real desktop shell with an isolated profile and no live API access.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'focus-smoke-')));
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.url.startsWith('https://') && !details.url.startsWith('https://cgalloway.github.io/focus/') });
  });
});
const errors = [];
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
});
require('../main.js');
const timeout = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    const state = await win.webContents.executeJavaScript(`({ origin: location.origin, bridge: !!window.focusAPI, ready: typeof timerTextCache === 'object', setup: !!document.getElementById('connectBtn') })`);
    assert.equal(state.origin, 'https://cgalloway.github.io');
    assert.equal(state.bridge, true);
    assert.equal(state.ready, true);
    assert.equal(state.setup, true);
    const escaped = await win.webContents.executeJavaScript(`escHtml('A \"quoted\" <project> & more')`);
    assert.equal(escaped, 'A &quot;quoted&quot; &lt;project&gt; &amp; more');
    const normal = win.getBounds();
    await win.webContents.executeJavaScript('focusAPI.toggleCompact(true)');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(win.isAlwaysOnTop(), true);
    await win.webContents.executeJavaScript('focusAPI.toggleCompact(true)');
    await win.webContents.executeJavaScript('focusAPI.toggleCompact(false)');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(win.isAlwaysOnTop(), false);
    assert.equal(win.getBounds().height, normal.height);
    assert.deepEqual(errors, []);
    console.log('PASS: bundled UI, original storage origin, bridge, startup, compact round trip, no renderer errors');
    clearTimeout(timeout);
    app.exit(0);
  } catch (err) { console.error(err); app.exit(1); }
});
