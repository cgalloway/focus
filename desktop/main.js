// Bundled UI at the original origin preserves existing user data.
const { app, BrowserWindow, ipcMain, shell, safeStorage, screen, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// The deployed web app — must match the URL the iPhone build is served from.
const APP_URL = 'https://cgalloway.github.io/focus/';

const NORMAL = { width: 460, height: 740, minWidth: 380, minHeight: 600 };
const COMPACT = { width: 380, height: 64 };

let win = null;
let overlayWin = null;
let normalBounds = null;  // saved when entering compact mode
let isCompactMode = false;
let compactBounds = null; // the user's chosen size for the minimal bar

// The compact bar's size/position survives relaunches.
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (s && s.compactBounds) compactBounds = s.compactBounds;
  } catch (e) { /* first run */ }
}
function saveWindowState() {
  try { fs.writeFileSync(statePath(), JSON.stringify({ compactBounds })); } catch (e) {}
}

// ---- Token storage (safeStorage-encrypted file in userData) ----------------

const tokenPath = () => path.join(app.getPath('userData'), 'token.enc');

function readToken() {
  try {
    const raw = fs.readFileSync(tokenPath());
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(raw);
    return raw.toString('utf8'); // written before encryption was available
  } catch (e) {
    return '';
  }
}

function writeToken(token) {
  try {
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(String(token || ''))
      : Buffer.from(String(token || ''), 'utf8');
    fs.writeFileSync(tokenPath(), data);
    return true;
  } catch (e) {
    console.error('token write failed', e);
    return false;
  }
}

// ---- Windows ----------------------------------------------------------------

function createWindow() {
  isCompactMode = false;
  normalBounds = null;
  win = new BrowserWindow({
    width: NORMAL.width,
    height: NORMAL.height,
    minWidth: NORMAL.minWidth,
    minHeight: NORMAL.minHeight,
    // The page paints no background under Electron and relies on native
    // vibrancy showing through (see the CSS notes in index.html).
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'followWindow',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(APP_URL).catch(err => console.error('Focus load failed', err));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppPage(url)) { event.preventDefault(); openExternal(url); }
  });

  // Any link the page didn't route through openExternal still opens in the
  // browser, never in a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  // Remember whatever size the user drags the minimal bar to.
  let saveTimer = null;
  const rememberCompactBounds = () => {
    if (!isCompactMode || !win) return;
    compactBounds = win.getBounds();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 400);
  };
  win.on('resize', rememberCompactBounds);
  win.on('move', rememberCompactBounds);

  win.on('close', () => { clearTimeout(saveTimer); saveWindowState(); });
  win.on('closed', () => { win = null; isCompactMode = false; });
}

// ---- IPC: the focusAPI surface ---------------------------------------------

function isAppPage(value) {
  try {
    const url = new URL(value);
    return url.origin === new URL(APP_URL).origin && ['/focus/', '/focus/index.html'].includes(url.pathname);
  } catch { return false; }
}
function openExternal(url) {
  if (typeof url === 'string' && /^(https?|todoist):/.test(url)) {
    shell.openExternal(url).catch(err => console.error('Cannot open link', err.message));
  }
}
function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !isAppPage(event.senderFrame.url)) throw new Error('Untrusted Focus request');
    return callback(event, ...args);
  });
}
handle('focus:get-token', () => readToken());
handle('focus:set-token', (e, token) => typeof token === 'string' && writeToken(token));
handle('focus:open-external', (e, url) => openExternal(url));

handle('focus:toggle-compact', (e, isCompact) => {
  if (!win || isCompactMode === !!isCompact) return;
  isCompactMode = !!isCompact;
  if (isCompact) {
    normalBounds = win.getBounds();
    win.setMinimumSize(260, 44);
    // Vibrancy fills the whole window rect; the compact pill draws its own
    // island inside transparent padding, so drop vibrancy while compact.
    win.setVibrancy(null);
    win.setAlwaysOnTop(true, 'floating');
    // No traffic lights on the pill — they overlapped the timer digits.
    if (typeof win.setWindowButtonVisibility === 'function') win.setWindowButtonVisibility(false);
    // Stays resizable: drag any edge to make the bar the size you like; the
    // chosen size is remembered here and across relaunches.
    win.setBounds(compactBounds || { ...win.getBounds(), width: COMPACT.width, height: COMPACT.height }, true);
  } else {
    win.setAlwaysOnTop(false);
    win.setVibrancy('under-window');
    if (typeof win.setWindowButtonVisibility === 'function') win.setWindowButtonVisibility(true);
    win.setMinimumSize(NORMAL.minWidth, NORMAL.minHeight);
    win.setBounds(normalBounds || { width: NORMAL.width, height: NORMAL.height }, true);
  }
});

handle('focus:show-confetti', () => {
  if (overlayWin) return; // one celebration at a time
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  overlayWin = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true); // clicks pass straight through
  overlayWin.loadFile(path.join(__dirname, 'overlay.html')).catch(() => {});
  setTimeout(() => { if (overlayWin) { overlayWin.close(); overlayWin = null; } }, 4500);
  overlayWin.on('closed', () => { overlayWin = null; });
});

// ---- App lifecycle ----------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    const bundled = new Set(['index.html', 'focus-sync.js', 'focus-push.js', 'confetti.browser.min.js']);
    protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.origin === new URL(APP_URL).origin && url.pathname.startsWith('/focus/')) {
        const file = url.pathname.slice('/focus/'.length) || 'index.html';
        if (bundled.has(file)) return net.fetch(pathToFileURL(path.join(__dirname, 'app', file)).href);
      }
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    });
    loadWindowState();
    // Standard Edit/Window menus so copy, paste and Cmd+W behave natively.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
    ]));
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
