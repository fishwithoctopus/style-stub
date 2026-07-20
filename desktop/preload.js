const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('styleStubDesktop', {
  isDesktop: true,
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  setAlwaysOnTop: value => ipcRenderer.send('window:always-on-top', Boolean(value)),
  setWindowSize: (width, height) => ipcRenderer.send('window:resize', { width, height })
});
