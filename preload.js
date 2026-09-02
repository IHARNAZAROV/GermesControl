const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getState: () => ipcRenderer.invoke('app:getState'),
    selectAndImportFile: (sourceKey) => ipcRenderer.invoke('app:selectAndImportFile', sourceKey),
    importSiteFromUrl: () => ipcRenderer.invoke('app:importSiteFromUrl'),
    importIlvoFromApi: () => ipcRenderer.invoke('app:importIlvoFromApi'),
    importKufarFromUrl: (url) => ipcRenderer.invoke('app:importKufarFromUrl', url),
    runCheck: () => ipcRenderer.invoke('app:runCheck'),
    getSettings: () => ipcRenderer.invoke('app:getSettings'),
    setSettings: (patch) => ipcRenderer.invoke('app:setSettings', patch),
    generateReport: (reportType, format) => ipcRenderer.invoke('app:generateReport', { reportType, format }),
    openPath: (targetPath) => ipcRenderer.invoke('app:openPath', targetPath)
});
