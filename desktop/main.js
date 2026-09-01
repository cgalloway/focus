/* ---------------------------------------------------------------------------
 * main.js — Electron shell for Focus.
 *
 * THE UPDATE MODEL is the whole point of this shell: the window loads the
 * DEPLOYED web app (the same URL the iPhone uses), so every fix pushed to the
 * repo reaches the desktop on the next launch with no rebuild. The copies in
 * app/ (refreshed by copy-app.js on every start/dist) are only the offline
 * fallback. Build the DMG once; after that, updates arrive on their own.
 *
 * The page detects Electron by the presence of window.focusAPI (see
 * preload.js) and expects exactly five things from this process:
 *   getToken/setToken  — Todoist token in safeStorage, never in localStorage
 *   toggleCompact      — resize the native window into a floating timer pill
 *   showConfetti       — click-through fullscreen confetti overlay
 *   openExternal       — hand todoist:// and https:// links to the OS
 * ------------------------------------------------------------------------- */

const { app, BrowserWindow, ipcMain, shell, safeStorage, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// The deployed web app — must match the URL the iPhone build is served from.
const APP_URL = 'https://cgalloway.github.io/focus/';
const LOCAL_FALLBACK = path.join(__dirname, 'app', 'index.html');

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

  // Remote-first, local when offline. Later in-page navigation failures
  // (e.g. Cmd+R with no network) fall back the same way.
  win.loadURL(APP_URL).catch(() => win.loadFile(LOCAL_FALLBACK));
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    // -3 is ERR_ABORTED: the page itself cancelled the navigation (a redirect,
    // a reload racing a load). It is not a failure and must not swap the live
    // app for the offline copy.
    if (isMainFrame && code !== -3) win.loadFile(LOCAL_FALLBACK).catch(() => {});
  });

  // Any link the page didn't route through openExternal still opens in the
  // browser, never in a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|todoist):/.test(url)) shell.openExternal(url);
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

  win.on('closed', () => { win = null; });
}

// ---- IPC: the focusAPI surface ---------------------------------------------

ipcMain.handle('focus:get-token', () => readToken());
ipcMain.handle('focus:set-token', (e, token) => writeToken(token));

ipcMain.handle('focus:open-external', (e, url) => {
  if (typeof url === 'string' && /^(https?|todoist):/.test(url)) shell.openExternal(url);
});

ipcMain.handle('focus:toggle-compact', (e, isCompact) => {
  if (!win) return;
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

ipcMain.handle('focus:show-confetti', () => {
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
