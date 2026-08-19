'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the sidebar UI and the main process. Every method is
// a fixed channel with no way for the renderer to name its own — the renderer
// cannot reach ipcRenderer directly.
contextBridge.exposeInMainWorld('accounts', {
  onState: (callback) => {
    ipcRenderer.on('accounts:state', (_event, state) => callback(state));
  },
  refresh: () => ipcRenderer.invoke('accounts:list'),
  add: () => ipcRenderer.invoke('accounts:add'),
  remove: (id) => ipcRenderer.invoke('accounts:remove', id),
  rename: (id, name) => ipcRenderer.invoke('accounts:rename', id, name),
  activate: (id) => ipcRenderer.send('accounts:activate', id),
  reload: (id) => ipcRenderer.send('accounts:reload', id),
  mute: (id, muted) => ipcRenderer.send('accounts:mute', id, muted),
  reorder: (ids) => ipcRenderer.send('accounts:reorder', ids),
  contextMenu: (id) => ipcRenderer.send('accounts:context-menu', id),

  // Sheets need more room than the 68px rail, so the main process widens
  // this view while one is open.
  overlay: (open) => ipcRenderer.send('ui:overlay', !!open),

  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  }
});
