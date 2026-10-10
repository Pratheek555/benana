const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('benana', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, fn) => {
    const handler = (_e, data) => fn(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
