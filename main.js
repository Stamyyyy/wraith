// Copyright (c) 2026 Stam. All rights reserved. See LICENSE.

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, globalShortcut, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win = null;
let tray = null;
let ptyModule = null;
let ptyLoadError = null;
let quitConfirmed = false; // set once the renderer has confirmed no unsaved notes remain
let quitCheckTimer = null; // also doubles as an "a check is already in flight" guard

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
const notesDirDefault = path.join(app.getPath('documents'), 'Wraith Notes');

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (e) {}
}
ensureDir(autosaveDir);

/* ---------- settings ---------- */
const DEFAULT_SETTINGS = {
  windowBounds: { width: 820, height: 580, x: undefined, y: undefined },
  textMode: 'faint',
  invertedText: false,
  charGlow: true,
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
  summonHotkey: 'CommandOrControl+`',
  summonAtMouse: false
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
    // Only let the window actually close once the app is genuinely quitting
    // (the renderer has already confirmed no unsaved notes remain) — the X
    // button and every other path still just hides to tray as before.
    if (quitConfirmed) return;
    e.preventDefault();
    win.hide();
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  win.show();
  win.focus();
}

/* ---------- "open in Wraith here" (Revenant, or any other launcher, spawns
   Wraith.exe with a target directory as an argument) ----------
   Electron's own argv shape differs between dev (`electron . <args>`, so
   args start at index 2) and packaged (`Wraith.exe <args>`, index 1) — the
   standard app.isPackaged check handles that. Rather than trust position
   alone (Electron/Squirrel can inject its own flags ahead of user args in
   some launch paths), the last argument that's actually a real directory on
   disk is taken as the target — anything else is ignored rather than
   crashing a normal argv-less launch. */
function extractDirArg(argv) {
  const userArgs = argv.slice(app.isPackaged ? 1 : 2);
  for (let i = userArgs.length - 1; i >= 0; i--) {
    try {
      if (fs.statSync(userArgs[i]).isDirectory()) return userArgs[i];
    } catch (err) {}
  }
  return null;
}

// Opens a new Command Prompt tab starting in `dir`. cmd, not wsl — the path
// handed in is always a plain Windows path (from Revenant or anywhere else
// that'd trigger this), and wsl.exe doesn't honor a Windows-side spawn cwd
// the way cmd.exe does, so there's no shell-type ambiguity to resolve here.
function openDirectoryTab(dir) {
  if (!win || win.isDestroyed()) { createWindow(); win.webContents.once('did-finish-load', () => openDirectoryTab(dir)); return; }
  showWindow();
  const send = () => win.webContents.send('open-directory-tab', dir);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}
function moveWindowToCursor() {
  if (!win || win.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const bounds = win.getBounds();
  const wa = display.workArea;
  let x = Math.round(point.x - bounds.width / 2);
  let y = Math.round(point.y - bounds.height / 2);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - bounds.width));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - bounds.height));
  win.setPosition(x, y);
}

// Used by the global summon hotkey specifically — repositions to the cursor
// (if enabled) only when actually about to show, never on hide/tray-click.
function summonToggle() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  const aboutToShow = !(win.isVisible() && !win.isMinimized());
  if (aboutToShow && settings.summonAtMouse) moveWindowToCursor();
  toggleWindow();
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
  tray.setToolTip('Wraith');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
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
      { name: 'Wraith Notes (formatted)', extensions: ['html'] },
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
        { name: 'Wraith Note (keeps formatting)', extensions: ['html'] }
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

/* ---------- IPC: confirm-before-quit (renderer walks its own dirty tabs
   through note-confirm-close/note-save, then reports back whether it's
   safe to actually exit) ---------- */
ipcMain.on('unsaved-check-result', (e, canQuit) => {
  if (quitCheckTimer) { clearTimeout(quitCheckTimer); quitCheckTimer = null; }
  if (canQuit) {
    quitConfirmed = true;
    app.quit();
  }
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
ipcMain.handle('terminal-available', () => true); // always true now: falls back to child_process if node-pty is missing
ipcMain.handle('terminal-mode', () => (ptyModule ? 'pty' : 'fallback'));

/* Wraps a plain child_process in the same {write,resize,kill,onData,onExit}
   shape node-pty gives us, so the rest of the app doesn't care which one is
   actually running. No real PTY means: no proper resize, and interactive
   line-editing/colors inside WSL specifically will be degraded (bash can't
   tell it has a terminal) — but commands run and output streams either way,
   instead of the tab just being dead. */
function spawnFallback(shell, args, cwd, env) {
  const cp = require('child_process').spawn(shell, args, { cwd, env, windowsHide: true });
  const dataCbs = [];
  const exitCbs = [];
  cp.stdout.on('data', (d) => dataCbs.forEach((cb) => cb(d.toString('utf8'))));
  cp.stderr.on('data', (d) => dataCbs.forEach((cb) => cb(d.toString('utf8'))));
  cp.on('error', (err) => dataCbs.forEach((cb) => cb(`\r\n[failed to start: ${err.message}]\r\n`)));
  cp.on('exit', () => exitCbs.forEach((cb) => cb()));
  return {
    write: (data) => { try { cp.stdin.write(data); } catch (e) {} },
    resize: () => {}, // plain pipes have no concept of terminal size
    kill: () => { try { cp.kill(); } catch (e) {} },
    onData: (cb) => dataCbs.push(cb),
    onExit: (cb) => exitCbs.push(cb)
  };
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

ipcMain.handle('terminal-spawn', async (e, { tabId, shellType, cwd }) => {
  const shell = shellType === 'wsl' ? 'wsl.exe' : (process.env.COMSPEC || 'cmd.exe');
  const usingFallback = !ptyModule;
  // Real directory (from "open in Wraith here") if given and it still
  // exists, else the usual default — never trust a caller-supplied cwd
  // blindly, a stale/typo'd path would otherwise fail the whole tab.
  let startDir = os.homedir();
  if (cwd) {
    try { if (fs.statSync(cwd).isDirectory()) startDir = cwd; } catch (err) {}
  }
  // Right after Windows logs in (e.g. this app started via "Start with Windows"),
  // wsl.exe can transiently fail to launch because the WSL virtual machine/service
  // hasn't finished starting yet. Retry a few times before giving up instead of
  // failing the tab permanently on that first attempt.
  const maxAttempts = shellType === 'wsl' ? 3 : 1;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const proc = ptyModule
        ? ptyModule.spawn(shell, [], { name: 'xterm-color', cols: 80, rows: 24, cwd: startDir, env: process.env })
        : spawnFallback(shell, [], startDir, process.env);

      proc.onData((data) => {
        if (win && !win.isDestroyed()) win.webContents.send('terminal-data', tabId, data);
      });
      proc.onExit(() => {
        ptyProcesses.delete(tabId);
        if (win && !win.isDestroyed()) win.webContents.send('terminal-exit', tabId);
      });
      ptyProcesses.set(tabId, proc);
      return { ok: true, fallback: usingFallback };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) await delay(1500);
    }
  }
  return { ok: false, error: String(lastErr) };
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
// Enforce single instance: a second launch just focuses the existing window
// instead of fighting the first one for the same cache/lock files (the exact
// error that came up when a leftover process was still running).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const dir = extractDirArg(argv);
    if (dir) openDirectoryTab(dir);
    else showWindow();
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();

    const initialDir = extractDirArg(process.argv);
    if (initialDir) openDirectoryTab(initialDir); // handles its own did-finish-load wait

    globalShortcut.register(settings.summonHotkey || 'CommandOrControl+`', () => {
      summonToggle();
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
}

app.on('window-all-closed', () => {
  // keep running in tray; do not quit
});

// Ask before actually quitting if any note has unsaved changes. The first
// before-quit is always intercepted (preventDefault) so we can ask the
// renderer; once it reports back "yes, safe to quit" via the
// 'unsaved-check-result' handler above, quitConfirmed is set and app.quit()
// is called again — that second time this handler just kills the terminal
// child processes and lets the quit actually proceed.
app.on('before-quit', (e) => {
  if (quitConfirmed) {
    for (const [, proc] of ptyProcesses) {
      try { proc.kill(); } catch (err) {}
    }
    return;
  }
  e.preventDefault();
  if (quitCheckTimer) return; // a check is already in flight — don't stack another prompt
  if (!win || win.isDestroyed()) { quitConfirmed = true; app.quit(); return; }

  // Bring the window forward so any "save changes?" dialog the renderer
  // triggers is actually visible, even if we were sitting hidden in the tray.
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('check-unsaved-before-quit');

  // Safety net: if the renderer never responds (crashed, stuck, whatever),
  // don't leave the app permanently unable to quit — force it through after
  // a while. Generous timeout since the user may be working through a
  // save-changes prompt for more than one note.
  quitCheckTimer = setTimeout(() => {
    quitCheckTimer = null;
    quitConfirmed = true;
    app.quit();
  }, 60000);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
