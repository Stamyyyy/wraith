// Copyright (c) 2026 Stam. All rights reserved. See LICENSE.

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = [
  'settings-get',
  'settings-set',
  'note-new-default',
  'note-open-dialog',
  'note-read-path',
  'note-save',
  'note-confirm-close',
  'autosave-write',
  'autosave-clear',
  'search-notes',
  'terminal-available',
  'terminal-mode',
  'terminal-spawn'
];

const SEND_CHANNELS = [
  'win-minimize',
  'win-close',
  'terminal-input',
  'terminal-resize',
  'terminal-kill',
  'toggle-click-through'
];

const RECEIVE_CHANNELS = [
  'terminal-data',
  'terminal-exit',
  'click-through-changed',
  'request-click-through-toggle'
];

contextBridge.exposeInMainWorld('ghost', {
  invoke: (channel, ...args) => {
    if (!INVOKE_CHANNELS.includes(channel)) return Promise.reject(new Error('blocked channel: ' + channel));
    return ipcRenderer.invoke(channel, ...args);
  },
  send: (channel, ...args) => {
    if (!SEND_CHANNELS.includes(channel)) return;
    ipcRenderer.send(channel, ...args);
  },
  on: (channel, cb) => {
    if (!RECEIVE_CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, ...args) => cb(...args));
  }
});
