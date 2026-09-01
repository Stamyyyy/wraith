const { app, BrowserWindow, Menu, dialog, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let currentFilePath = null;
let isDirty = false;
let clickThrough = false;

const isMac = process.platform === 'darwin';

function titleFor(filePath, dirty) {
  const name = filePath ? path.basename(filePath) : 'Untitled';
  return `${dirty ? '*' : ''}${name} - Ghost Notepad`;
}

function updateTitle() {
  if (win) win.setTitle(titleFor(currentFilePath, isDirty));
}

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 320,
    minHeight: 200,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'build', 'icon.ico')
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  updateTitle();

  win.on('close', (e) => {
    if (isDirty) {
      e.preventDefault();
      promptSaveBeforeAction(() => {
        win.destroy();
      });
    }
  });

  buildMenu();
}

/* ---------- unsaved-changes guard ---------- */
function promptSaveBeforeAction(continueAction) {
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save changes to ${currentFilePath ? path.basename(currentFilePath) : 'Untitled'}?`
  });
  if (choice === 0) {
    doSave(() => continueAction());
  } else if (choice === 1) {
    continueAction();
  }
  // choice === 2 (Cancel): do nothing
}

/* ---------- file operations ---------- */
function requestContent(cb) {
  ipcMain.once('content-response', (e, content) => cb(content));
  win.webContents.send('content-request');
}

function doNew() {
  const go = () => {
    currentFilePath = null;
    isDirty = false;
    win.webContents.send('load-content', '');
    updateTitle();
  };
  if (isDirty) promptSaveBeforeAction(go);
  else go();
}

function doOpen() {
  const go = () => {
    const files = dialog.showOpenDialogSync(win, {
      filters: [
        { name: 'Text Documents', extensions: ['txt'] },
        { name: 'Ghost Notes (formatted)', extensions: ['ghost.html'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (!files || !files.length) return;
    const filePath = files[0];
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      dialog.showErrorBox('Could not open file', String(err));
      return;
    }
    const isFormatted = filePath.toLowerCase().endsWith('.ghost.html');
    currentFilePath = filePath;
    isDirty = false;
    win.webContents.send('load-content', raw, isFormatted);
    updateTitle();
  };
  if (isDirty) promptSaveBeforeAction(go);
  else go();
}

function writeFile(filePath, content, cb) {
  fs.writeFile(filePath, content, 'utf8', (err) => {
    if (err) {
      dialog.showErrorBox('Could not save file', String(err));
      return;
    }
    currentFilePath = filePath;
    isDirty = false;
    updateTitle();
    if (cb) cb();
  });
}

function doSave(cb) {
  if (currentFilePath) {
    requestContent((content) => writeFile(currentFilePath, content, cb));
  } else {
    doSaveAs(cb);
  }
}

function doSaveAs(cb) {
  const result = dialog.showSaveDialogSync(win, {
    filters: [
      { name: 'Text Documents (plain)', extensions: ['txt'] },
      { name: 'Ghost Note (keeps formatting)', extensions: ['ghost.html'] }
    ],
    defaultPath: currentFilePath || 'Untitled.txt'
  });
  if (!result) return;
  const wantsFormatted = result.toLowerCase().endsWith('.ghost.html');
  ipcMain.once('content-response-typed', (e, plain, html) => {
    writeFile(result, wantsFormatted ? html : plain, cb);
  });
  win.webContents.send('content-request-typed');
}

/* ---------- menu ---------- */
function buildMenu() {
  const send = (channel, ...args) => () => win.webContents.send(channel, ...args);

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => doNew() },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { type: 'separator' },
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => doOpen() },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => doSave() },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => doSaveAs() },
        { type: 'separator' },
        { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: () => win.webContents.print() },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('do-undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: send('do-redo') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Delete', click: send('do-delete') },
        { type: 'separator' },
        { label: 'Find...', accelerator: 'CmdOrCtrl+F', click: send('open-find') },
        { label: 'Find Next', accelerator: 'F3', click: send('find-next') },
        { label: 'Find Previous', accelerator: 'Shift+F3', click: send('find-prev') },
        { label: 'Replace...', accelerator: 'CmdOrCtrl+H', click: send('open-replace') },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { label: 'Time/Date', accelerator: 'F5', click: send('insert-datetime') }
      ]
    },
    {
      label: 'Format',
      submenu: [
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: send('fmt-bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: send('fmt-italic') },
        { label: 'Underline', accelerator: 'CmdOrCtrl+U', click: send('fmt-underline') },
        { type: 'separator' },
        { label: 'Font...', click: send('open-font-picker') },
        { label: 'Word Wrap', type: 'checkbox', checked: true, click: (item) => win.webContents.send('toggle-wordwrap', item.checked) },
        { type: 'separator' },
        {
          label: 'Text Transparency',
          submenu: [
            { label: 'Fully Transparent', type: 'radio', checked: false, click: send('text-mode', 'ghost') },
            { label: 'Kinda Transparent', type: 'radio', checked: true, click: send('text-mode', 'faint') },
            { label: 'Solid (Black && White)', type: 'radio', checked: false, click: send('text-mode', 'solid') }
          ]
        },
        { label: 'Invert to White Text', type: 'checkbox', checked: false, click: (item) => win.webContents.send('toggle-white-text', item.checked) }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoom', 1) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoom', -1) },
        { label: 'Restore Default Zoom', accelerator: 'CmdOrCtrl+0', click: send('zoom', 0) },
        { type: 'separator' },
        { label: 'Status Bar', type: 'checkbox', checked: true, click: (item) => win.webContents.send('toggle-statusbar', item.checked) },
        { type: 'separator' },
        {
          label: 'Window Opacity',
          submenu: [
            { label: '100%', type: 'radio', checked: false, click: () => win.setOpacity(1.0) },
            { label: '85%', type: 'radio', checked: false, click: () => win.setOpacity(0.85) },
            { label: '65%', type: 'radio', checked: true, click: () => win.setOpacity(0.65) },
            { label: '40%', type: 'radio', checked: false, click: () => win.setOpacity(0.4) },
            { label: '20%', type: 'radio', checked: false, click: () => win.setOpacity(0.2) }
          ]
        },
        { label: 'Always on Top', type: 'checkbox', checked: false, click: (item) => win.setAlwaysOnTop(item.checked) },
        {
          label: 'Click-Through Mode',
          accelerator: 'CmdOrCtrl+Shift+T',
          type: 'checkbox',
          checked: false,
          click: (item) => setClickThrough(item.checked)
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setClickThrough(enabled) {
  clickThrough = enabled;
  win.setIgnoreMouseEvents(enabled, { forward: true });
  win.webContents.send('click-through-changed', enabled);
}

/* ---------- IPC from renderer ---------- */
ipcMain.on('mark-dirty', (e, dirty) => {
  isDirty = dirty;
  updateTitle();
});

ipcMain.on('request-toggle-click-through', () => {
  setClickThrough(!clickThrough);
});

ipcMain.on('win-minimize', () => { if (win) win.minimize(); });
ipcMain.on('win-close', () => { if (win) win.close(); });

app.whenReady().then(() => {
  createWindow();

  // Escape hatch: always lets you regain mouse control even mid click-through.
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    setClickThrough(!clickThrough);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
