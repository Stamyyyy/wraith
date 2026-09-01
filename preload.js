const { contextBridge, ipcRenderer } = require('electron');

const RECEIVE_CHANNELS = [
  'content-request',
  'content-request-typed',
  'load-content',
  'do-undo',
  'do-redo',
  'do-delete',
  'open-find',
  'find-next',
  'find-prev',
  'open-replace',
  'insert-datetime',
  'fmt-bold',
  'fmt-italic',
  'fmt-underline',
  'open-font-picker',
  'toggle-wordwrap',
  'text-mode',
  'toggle-white-text',
  'zoom',
  'toggle-statusbar',
  'click-through-changed'
];

const SEND_CHANNELS = [
  'content-response',
  'content-response-typed',
  'mark-dirty',
  'request-toggle-click-through',
  'win-minimize',
  'win-close'
];

contextBridge.exposeInMainWorld('ghost', {
  on: (channel, cb) => {
    if (!RECEIVE_CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, ...args) => cb(...args));
  },
  send: (channel, ...args) => {
    if (!SEND_CHANNELS.includes(channel)) return;
    ipcRenderer.send(channel, ...args);
  }
});
