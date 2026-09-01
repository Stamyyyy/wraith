const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win = null;
let tray = null;
let ptyModule = null;
let ptyLoadError = null;

try {
  ptyModule = require('node-pty');
} catch (err) {
  ptyLoadError = err;
}

const ptyProcesses = new Map(); // tabId -> pty process

/* ---------- paths ---------- */
const userDataDir = app.getPath('userData');
const settingsPath = path.join(userDataDir, 'settings.json');
const autosaveDir = path.join(userDataDir, 'autosave');
const notesDirDefault = path.join(app.getPath('documents'), 'Ghost Notes');

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (e) {}
}
ensureDir(autosaveDir);

/* ---------- settings ---------- */
const DEFAULT_SETTINGS = {
  windowBounds: { width: 820, height: 580, x: undefined, y: undefined },
  textMode: 'faint',
  invertedText: false,
  legibilityMode: 'alpha', // 'alpha' | 'blur' | 'both'
  blurAmount: 6,
  fontFamily: "Consolas, monospace",
  fontSize: 14,
  wordWrap: true,
  windowOpacity: 0.65,
  alwaysOnTop: false,
  autosaveIntervalSec: 20,
  notesDir: notesDirDefault,
  startWithWindows: false,
  spellcheck: true,
  summonHotkey: 'CommandOrControl+`'
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}
function saveSettings(s) {
  try { fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf8'); } catch (e) {}
}

let settings = loadSettings();
ensureDir(settings.notesDir);

/* ---------- filename helpers ---------- */
function sanitizeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
}
function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

/* ---------- window ---------- */
function createWindow() {
  const b = settings.windowBounds || {};
  win = new BrowserWindow({
    width: b.width || 820,
    height: b.height || 580,
    x: b.x,
    y: b.y,
    minWidth: 360,
    minHeight: 240,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: true,
    alwaysOnTop: !!settings.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: !!settings.spellcheck
    },
    icon: path.join(__dirname, 'build', 'icon.ico')
  });

  win.setOpacity(typeof settings.windowOpacity === 'number' ? settings.windowOpacity : 0.65);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const persistBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    settings.windowBounds = win.getBounds();
    saveSettings(settings);
  };
  win.on('move', persistBounds);
  win.on('resize', persistBounds);

  win.webContents.on('context-menu', (event, params) => {
    if (!params.misspelledWord) return;
    const menu = Menu.buildFromTemplate(
      params.dictionarySuggestions.map((s) => ({
        label: s,
        click: () => win.webContents.replaceMisspelling(s)
      })).concat([
        { type: 'separator' },
        { label: 'Add to Dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }
      ])
    );
    menu.popup();
  });

  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  win.show();
  win.focus();
}
function toggleWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isVisible() && !win.isMinimized()) win.hide();
  else showWindow();
}

/* ---------- tray ---------- */
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.ico'));
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Ghost Notepad');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => toggleWindow());
}

/* ---------- IPC: settings ---------- */
ipcMain.handle('settings-get', () => settings);
ipcMain.handle('settings-set', (e, patch) => {
  settings = Object.assign({}, settings, patch);
  saveSettings(settings);
  if (patch.notesDir) ensureDir(settings.notesDir);
  if (win && !win.isDestroyed()) {
    if (typeof patch.windowOpacity === 'number') win.setOpacity(patch.windowOpacity);
    if (typeof patch.alwaysOnTop === 'boolean') win.setAlwaysOnTop(patch.alwaysOnTop);
  }
  if (typeof patch.startWithWindows === 'boolean') {
    app.setLoginItemSettings({ openAtLogin: patch.startWithWindows });
  }
  return settings;
});

/* ---------- IPC: window chrome ---------- */
ipcMain.on('win-minimize', () => { if (win) win.minimize(); });
ipcMain.on('win-close', () => { if (win) win.hide(); });

/* ---------- IPC: file ops (per-tab, stateless in main) ---------- */
ipcMain.handle('note-new-default', () => {
  return { title: `Note ${dateStamp()}`, filePath: null };
});

ipcMain.handle('note-open-dialog', async () => {
  const files = dialog.showOpenDialogSync(win, {
    defaultPath: settings.notesDir,
    filters: [
      { name: 'Text Documents', extensions: ['txt'] },
      { name: 'Ghost Notes (formatted)', extensions: ['html'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (!files || !files.length) return null;
  const filePath = files[0];
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    dialog.showErrorBox('Could not open file', String(err));
    return null;
  }
  const isFormatted = filePath.toLowerCase().endsWith('.html');
  return { filePath, title: path.basename(filePath), content: raw, isFormatted };
});

ipcMain.handle('note-read-path', (e, filePath) => {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    dialog.showErrorBox('Could not open file', String(err));
    return null;
  }
  const isFormatted = filePath.toLowerCase().endsWith('.html');
  return { filePath, title: path.basename(filePath), content: raw, isFormatted };
});

ipcMain.handle('note-save', (e, { filePath, plain, html, wantsFormatted, suggestedTitle }) => {
  let target = filePath;
  if (!target) {
    const name = sanitizeFilename(suggestedTitle || `Note ${dateStamp()}`);
    target = dialog.showSaveDialogSync(win, {
      defaultPath: path.join(settings.notesDir, name + (wantsFormatted ? '.html' : '.txt')),
      filters: [
        { name: 'Text Documents (plain)', extensions: ['txt'] },
        { name: 'Ghost Note (keeps formatting)', extensions: ['html'] }
      ]
    });
    if (!target) return null;
  }
  const isFormatted = target.toLowerCase().endsWith('.html');
  try {
    fs.writeFileSync(target, isFormatted ? html : plain, 'utf8');
  } catch (err) {
    dialog.showErrorBox('Could not save file', String(err));
    return null;
  }
  return { filePath: target, title: path.basename(target) };
});

ipcMain.handle('note-confirm-close', (e, { title }) => {
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save changes to ${title}?`
  });
  return ['save', 'discard', 'cancel'][choice];
});

/* ---------- IPC: autosave (recovery slot for untitled notes) ---------- */
ipcMain.handle('autosave-write', (e, { tabId, plain }) => {
  try {
    fs.writeFileSync(path.join(autosaveDir, `${tabId}.txt`), plain, 'utf8');
  } catch (err) {}
});
ipcMain.handle('autosave-clear', (e, { tabId }) => {
  try { fs.unlinkSync(path.join(autosaveDir, `${tabId}.txt`)); } catch (err) {}
});

/* ---------- IPC: search notes (safe: pure JS, no shell) ---------- */
ipcMain.handle('search-notes', (e, query) => {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(txt|html)$/i.test(entry.name)) continue;
      const nameMatch = entry.name.toLowerCase().includes(q);
      let snippet = null;
      let contentMatch = false;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const idx = content.toLowerCase().indexOf(q);
        if (idx !== -1) {
          contentMatch = true;
          const start = Math.max(0, idx - 40);
          snippet = content.slice(start, idx + q.length + 40).replace(/\s+/g, ' ');
        }
      } catch (e) {}
      if (nameMatch || contentMatch) {
        results.push({ filePath: full, title: entry.name, snippet, nameMatch });
        if (results.length >= 50) return;
      }
    }
  }
  walk(settings.notesDir);
  return results;
});

/* ---------- IPC: terminal (PTY) ---------- */
ipcMain.handle('terminal-available', () => !ptyLoadError);

ipcMain.handle('terminal-spawn', (e, { tabId, shellType }) => {
  if (!ptyModule) {
    return { ok: false, error: ptyLoadError ? ptyLoadError.message : 'node-pty not available' };
  }
  let shell, args;
  if (shellType === 'wsl') {
    shell = 'wsl.exe';
    args = [];
  } else {
    shell = process.env.COMSPEC || 'cmd.exe';
    args = [];
  }
  try {
    const proc = ptyModule.spawn(shell, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: process.env
    });
    proc.onData((data) => {
      if (win && !win.isDestroyed()) win.webContents.send('terminal-data', tabId, data);
    });
    proc.onExit(() => {
      ptyProcesses.delete(tabId);
      if (win && !win.isDestroyed()) win.webContents.send('terminal-exit', tabId);
    });
    ptyProcesses.set(tabId, proc);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.on('terminal-input', (e, tabId, data) => {
  const proc = ptyProcesses.get(tabId);
  if (proc) proc.write(data);
});

ipcMain.on('terminal-resize', (e, tabId, cols, rows) => {
  const proc = ptyProcesses.get(tabId);
  if (proc) {
    try { proc.resize(cols, rows); } catch (err) {}
  }
});

ipcMain.on('terminal-kill', (e, tabId) => {
  const proc = ptyProcesses.get(tabId);
  if (proc) {
    try { proc.kill(); } catch (err) {}
    ptyProcesses.delete(tabId);
  }
});

/* ---------- IPC: click-through & always-on-top ---------- */
let clickThrough = false;
ipcMain.on('toggle-click-through', () => {
  clickThrough = !clickThrough;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  win.webContents.send('click-through-changed', clickThrough);
});

/* ---------- app lifecycle ---------- */
app.whenReady().then(() => {
  createWindow();
  createTray();

  globalShortcut.register(settings.summonHotkey || 'CommandOrControl+`', () => {
    toggleWindow();
  });
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (win && !win.isDestroyed()) win.webContents.send('request-click-through-toggle');
  });

  if (settings.startWithWindows) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  // keep running in tray; do not quit
});

app.on('before-quit', () => {
  for (const [, proc] of ptyProcesses) {
    try { proc.kill(); } catch (e) {}
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
