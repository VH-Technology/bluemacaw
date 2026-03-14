const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ada', {
  onToggleRecording: (callback) => ipcRenderer.on('toggle-recording', (_e, recording) => callback(recording)),
  transcribe: (audioBuffer) => ipcRenderer.invoke('transcribe', audioBuffer),
});
