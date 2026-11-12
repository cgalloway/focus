// Bundled UI at the original origin preserves existing user data.
const { app, BrowserWindow, ipcMain, shell, safeStorage, screen, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// The origin the bundled interface is served at. It must stay the URL of the
// deployed web app: local storage (settings, session, sync identity) is keyed
// to this origin, so changing it would orphan existing data.
const APP_URL = 'https://cgalloway.github.io/focus/';

const NORMAL = { width: 1120, height: 820, minWidth: 380, minHeight: 600 };
const COMPACT = { width: 480, height: 80 };
let compactLayout = 'task';
let snapCompact = false;
let compactLayouts = {};

let win = null;
let overlayWin = null;
let normalBounds = null;  // saved when entering compact mode
let isCompactMode = false;
let compactBounds = null; // the user's chosen size for the minimal bar
let compactAnchorX = null; // left edge the user chose for the bar
let compactFittedX = null; // left edge last set by fit-compact-content

// The compact bar's size/position survives relaunches.
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (s && s.compactBounds) compactBounds = s.compactBounds;
    if (s && s.normalBounds) normalBounds = s.normalBounds;
    compactLayouts = s.compactLayouts || {};
    snapCompact = s.snapCompact === true;
  } catch (e) { /* first run */ }
}
function saveWindowState() {
  try { fs.writeFileSync(statePath(), JSON.stringify({ compactBounds, normalBounds, compactLayouts, snapCompact })); } catch (e) {}
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

// Restore safely when a saved external monitor is no longer connected.
function fitWindowBounds(bounds, defaults) {
  const valid = bounds && ['x','y','width','height'].every(k => Number.isFinite(bounds[k]));
  const area = (valid ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay()).workArea;
  const width = Math.min(area.width, Math.max(defaults.minWidth, valid ? bounds.width : defaults.width));
  const height = Math.min(area.height, Math.max(defaults.minHeight, valid ? bounds.height : defaults.height));
  return { width, height,
    x: Math.round(Math.max(area.x, Math.min(valid ? bounds.x : area.x + (area.width-width)/2, area.x+area.width-width))),
    y: Math.round(Math.max(area.y, Math.min(valid ? bounds.y : area.y + (area.height-height)/2, area.y+area.height-height))) };
}

function createWindow() {
  isCompactMode = false;
  const restored = fitWindowBounds(normalBounds, NORMAL);
  win = new BrowserWindow({
    width: NORMAL.width,
    height: NORMAL.height,
    ...restored,
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
    if (!win || win.isMinimized() || win.isFullScreen()) return;
    if (isCompactMode) { compactBounds = win.getBounds(); compactLayouts[compactLayout]=compactBounds; }
    else normalBounds = win.getBounds();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 400);
  };
  win.on('resize', rememberCompactBounds);
  win.on('move', rememberCompactBounds);
  win.on('moved', () => {
    if (!win || !isCompactMode || !snapCompact) return;
    const b=win.getBounds(), area=screen.getDisplayMatching(b).workArea;
    let x=b.x, y=b.y;
    if(Math.abs(x-area.x)<20) x=area.x;
    else if(Math.abs(x+b.width-area.x-area.width)<20) x=area.x+area.width-b.width;
    if(Math.abs(y-area.y)<20) y=area.y;
    else if(Math.abs(y+b.height-area.y-area.height)<20) y=area.y+area.height-b.height;
    if(x!==b.x || y!==b.y) win.setPosition(x,y);
  });

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
handle('focus:get-version', () => app.getVersion());
handle('focus:get-token', () => readToken());
handle('focus:set-token', (e, token) => typeof token === 'string' && writeToken(token));
handle('focus:open-external', (e, url) => openExternal(url));

handle('focus:toggle-compact', (e, isCompact, layout) => {
  if (!win || isCompactMode === !!isCompact) return;
  isCompactMode = !!isCompact;
  compactAnchorX = null;
  if (isCompact) {
    normalBounds = win.getBounds();
    compactLayout = layout === 'timer' ? 'timer' : 'task';
    win.setMinimumSize(compactLayout === 'timer' ? 400 : 480, 80);
    // Vibrancy fills the whole window rect; the compact pill draws its own
    // island inside transparent padding, so drop vibrancy while compact.
    win.setVibrancy(null);
    win.setAlwaysOnTop(true, 'floating');
    // No traffic lights on the pill — they overlapped the timer digits.
    if (typeof win.setWindowButtonVisibility === 'function') win.setWindowButtonVisibility(false);
    // Stays resizable: drag any edge to make the bar the size you like; the
    // chosen size is remembered here and across relaunches.
    const preferred=compactLayouts[compactLayout] || { ...win.getBounds(), width:compactLayout==='timer'?400:480, height:80 };
    win.setBounds(fitWindowBounds(preferred, { ...COMPACT, minWidth:compactLayout==='timer'?400:480, minHeight:80 }), true);
  } else {
    win.setAlwaysOnTop(false);
    win.setVibrancy('under-window');
    if (typeof win.setWindowButtonVisibility === 'function') win.setWindowButtonVisibility(true);
    win.setMinimumSize(NORMAL.minWidth, NORMAL.minHeight);
    win.setBounds(fitWindowBounds(normalBounds, NORMAL), true);
  }
});

handle('focus:set-compact-layout', (e, layout) => {
  if (!win || !isCompactMode || !['timer','task'].includes(layout)) return;
  compactLayouts[compactLayout]=win.getBounds();
  compactLayout=layout;
  compactAnchorX=null;
  win.setMinimumSize(layout==='timer'?400:480,80);
  win.setBounds(fitWindowBounds(compactLayouts[layout] || {...win.getBounds(),width:layout==='timer'?400:480,height:80}, {...COMPACT,minWidth:layout==='timer'?400:480,minHeight:80}));
  saveWindowState();
});
handle('focus:fit-compact-content', (e, requestedWidth, requestedHeight) => {
  if (!win || !isCompactMode || !Number.isFinite(requestedWidth) || !Number.isFinite(requestedHeight)) return;
  const bounds=win.getBounds(), area=screen.getDisplayMatching(bounds).workArea;
  const width=Math.min(area.width,Math.max(compactLayout==='timer'?400:480,Math.ceil(requestedWidth)));
  const height=Math.min(area.height,Math.max(80,Math.ceil(requestedHeight)));
  // The task controls sit at the left of the pill, so keep its left edge where
  // the user put it and let the title end grow or shrink. A title too long for
  // the screen pushes the pill left only until a shorter one fits again.
  if (compactAnchorX === null || bounds.x !== compactFittedX) compactAnchorX = bounds.x;
  const x=Math.min(Math.max(area.x,compactAnchorX),area.x+area.width-width);
  const y=Math.min(Math.max(area.y,bounds.y),area.y+area.height-height);
  compactFittedX = x;
  if(width!==bounds.width || height!==bounds.height || x!==bounds.x || y!==bounds.y) win.setBounds({x,y,width,height});
});
let compactMenuWindow = null;
let finishCompactMenu = null;
ipcMain.on('focus:compact-menu-action', (event, action) => {
  if (!compactMenuWindow || event.sender !== compactMenuWindow.webContents || event.senderFrame !== compactMenuWindow.webContents.mainFrame) return;
  if (!['','extend','later','previous','next','add','remove','timer','task','snap','expand'].includes(action)) return;
  if(action==='snap'){snapCompact=!snapCompact;saveWindowState();}
  finishCompactMenu?.(action);
});
handle('focus:compact-menu', (e, options = {}) => new Promise(resolve => {
  finishCompactMenu?.('');
  const bounds=win.getBounds(), area=screen.getDisplayMatching(bounds).workArea;
  const width=Math.min(288,area.width),height=Math.min(476,area.height);
  const x=Math.max(area.x,Math.min(bounds.x+bounds.width-width,area.x+area.width-width));
  const y=Math.max(area.y,Math.min(bounds.y+bounds.height+4,area.y+area.height-height));
  const popup=new BrowserWindow({width,height,x,y,frame:false,resizable:false,minimizable:false,maximizable:false,skipTaskbar:true,show:false,parent:win,backgroundColor:'#f8faf6',webPreferences:{preload:path.join(__dirname,'compact-menu-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  compactMenuWindow=popup;
  popup.setAlwaysOnTop(true,'pop-up-menu');
  let done=false;
  const finish=action=>{if(done)return;done=true;if(compactMenuWindow===popup){compactMenuWindow=null;finishCompactMenu=null;}resolve(action);if(!popup.isDestroyed())popup.close();};
  finishCompactMenu=finish;
  popup.on('closed',()=>finish(''));
  popup.on('blur',()=>finish(''));
  popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  popup.webContents.on('will-navigate',event=>event.preventDefault());
  const items=[
    {label:'Add 5 minutes',id:'extend',enabled:!!options.canExtend},
    {label:'Do later — move to end',id:'later',enabled:!!options.multiple},
    {label:'Previous task',id:'previous',enabled:!!options.multiple},
    {label:'Next task',id:'next',enabled:!!options.multiple},
    {separator:true},{label:'Add Todoist tasks…',id:'add'},
    {label:'Remove from session',id:'remove',enabled:!!options.hasTask},
    {separator:true},{label:'Timer only',id:'timer',checked:compactLayout==='timer'},
    {label:'Timer and task',id:'task',checked:compactLayout==='task'},
    {label:'Snap to screen edges',id:'snap',checked:snapCompact},
    {separator:true},{label:'Open full Focus window',id:'expand'}
  ];
  popup.loadFile(path.join(__dirname,'compact-menu.html')).then(async()=>{
    if(done)return;
    await popup.webContents.executeJavaScript('window.renderMenu('+JSON.stringify(items)+')');
    if(!done){popup.show();popup.focus();}
  }).catch(error=>{console.error('Compact menu failed',error.message);finish('');});
}));

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
    const bundled = new Set(require('./app-files.js'));
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
