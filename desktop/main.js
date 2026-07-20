const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, screen, dialog, safeStorage, Menu, Tray } = require('electron');
const { startGateway } = require('../server/gateway');
const { detectSnapEdge, restoreWindowBounds, snapX } = require('./window-state');

const PAPER_MARGIN = 24;
const DEFAULT_WIDTH = 340;
const DEFAULT_HEIGHT = 720;
const EDGE_SNAP_DISTANCE = 34;
const SNAP_OVERHANG = 12;

let mainWindow = null;
let gatewayServer = null;
let tray = null;
let snapEdge = null;
let snapTimer = null;
let stateTimer = null;
let isSnapping = false;
let isQuitting = false;

function keyStorePath() {
  return path.join(app.getPath('userData'), 'api-keys.encrypted.json');
}

function loadStoredKeys() {
  if (!safeStorage.isEncryptionAvailable()) return {};
  try {
    const encrypted = JSON.parse(fs.readFileSync(keyStorePath(), 'utf8'));
    return Object.fromEntries(Object.entries(encrypted).flatMap(([provider, value]) => {
      try { return [[provider, safeStorage.decryptString(Buffer.from(String(value), 'base64'))]]; }
      catch { return []; }
    }));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[Style Stub] encrypted key store could not be read');
    return {};
  }
}

function saveStoredKeys(keys) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用');
  const encrypted = Object.fromEntries(Object.entries(keys).flatMap(([provider, value]) => {
    const key = String(value || '').trim();
    return key ? [[provider, safeStorage.encryptString(key).toString('base64')]] : [];
  }));
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(keyStorePath(), JSON.stringify(encrypted), { encoding: 'utf8', mode: 0o600 });
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(windowStatePath(), 'utf8')); }
  catch { return {}; }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(windowStatePath(), JSON.stringify({ ...bounds, snapEdge }), 'utf8');
}

function scheduleWindowStateSave() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(saveWindowState, 180);
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showMainWindow();
}

function setAlwaysOnTop(value) {
  mainWindow?.setAlwaysOnTop(Boolean(value), 'floating');
  rebuildTrayMenu();
}

function snapWindow(edge, animate = true) {
  if (!mainWindow || mainWindow.isDestroyed() || !['left', 'right'].includes(edge)) return;
  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const x = snapX(edge, workArea, bounds.width, SNAP_OVERHANG);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - 80);
  snapEdge = edge;
  isSnapping = true;
  mainWindow.setPosition(Math.round(x), Math.round(y), animate);
  setTimeout(() => { isSnapping = false; scheduleWindowStateSave(); }, 80);
}

function scheduleEdgeSnap() {
  if (isSnapping || !mainWindow) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const detected = detectSnapEdge(bounds, workArea, EDGE_SNAP_DISTANCE, SNAP_OVERHANG);
    if (detected) snapWindow(detected);
    else if (snapEdge) { snapEdge = null; scheduleWindowStateSave(); }
  }, 180);
}

function rebuildTrayMenu() {
  if (!tray || !mainWindow) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏风格票根', click: toggleMainWindow },
    { type: 'separator' },
    { label: '始终置顶', type: 'checkbox', checked: mainWindow.isAlwaysOnTop(), click: item => setAlwaysOnTop(item.checked) },
    { label: '贴到屏幕左侧', click: () => snapWindow('left') },
    { label: '贴到屏幕右侧', click: () => snapWindow('right') },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'build', 'tray.ico'));
  tray.setToolTip('风格票根 Style Stub');
  tray.on('click', toggleMainWindow);
  rebuildTrayMenu();
}

console.log('[Style Stub] desktop main loaded');

function createMainWindow(gatewayPort) {
  const display = screen.getPrimaryDisplay();
  const width = DEFAULT_WIDTH + PAPER_MARGIN;
  const height = DEFAULT_HEIGHT + PAPER_MARGIN;
  const defaults = {
    width,
    height,
    x: Math.max(display.workArea.x, display.workArea.x + display.workArea.width - width - 18),
    y: display.workArea.y + 18
  };
  const restored = restoreWindowBounds(loadWindowState(), screen.getAllDisplays(), defaults, { overhang: SNAP_OVERHANG });
  snapEdge = restored.snapEdge;

  mainWindow = new BrowserWindow({
    ...restored.bounds,
    minWidth: 284,
    minHeight: 544,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    show: false,
    title: '风格票根 Style Stub',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.loadURL(`http://127.0.0.1:${gatewayPort}/?desktop=1&gatewayPort=${gatewayPort}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('move', () => { scheduleWindowStateSave(); scheduleEdgeSnap(); });
  mainWindow.on('resize', () => {
    scheduleWindowStateSave();
    if (snapEdge && !isSnapping) setTimeout(() => snapWindow(snapEdge, false), 80);
  });
  mainWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.hide());
ipcMain.on('window:always-on-top', (_event, value) => setAlwaysOnTop(value));
ipcMain.on('window:resize', (_event, size) => {
  const width = Math.max(260, Math.min(760, Number(size?.width) || DEFAULT_WIDTH));
  const height = Math.max(520, Math.min(1000, Number(size?.height) || DEFAULT_HEIGHT));
  mainWindow?.setSize(Math.round(width + PAPER_MARGIN), Math.round(height + PAPER_MARGIN), true);
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  showMainWindow();
});

app.whenReady().then(async () => {
  console.log('[Style Stub] Electron ready');
  try {
    const encryptedStorageAvailable = safeStorage.isEncryptionAvailable();
    gatewayServer = await startGateway({
      port: 0,
      quiet: true,
      initialSecrets: encryptedStorageAvailable ? loadStoredKeys() : {},
      onSecretsChanged: encryptedStorageAvailable ? saveStoredKeys : null,
      secretStorage: encryptedStorageAvailable ? 'os-encrypted' : 'memory-only'
    });
    console.log('[Style Stub] local gateway ready');
    createMainWindow(gatewayServer.address().port);
    createTray();
    screen.on('display-metrics-changed', () => { if (snapEdge) snapWindow(snapEdge, false); });
  } catch (error) {
    console.error('[Style Stub] startup failed', error);
    dialog.showErrorBox('风格票根无法启动', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
app.on('before-quit', () => {
  isQuitting = true;
  saveWindowState();
  gatewayServer?.close();
});
