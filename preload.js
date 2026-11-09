const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getState: () => ipcRenderer.invoke('app:getState'),
    selectAndImportFile: (sourceKey) => ipcRenderer.invoke('app:selectAndImportFile', sourceKey),
    importSiteFromUrl: () => ipcRenderer.invoke('app:importSiteFromUrl'),
    importKufarFromUrl: (url) => ipcRenderer.invoke('app:importKufarFromUrl', url),
    importBizlidaFromUrl: () => ipcRenderer.invoke('app:importBizlidaFromUrl'),
    onBizlidaProgress: (callback) => {
        const listener = (_event, progress) => callback(progress);
        ipcRenderer.on('app:bizlidaProgress', listener);
        return () => ipcRenderer.removeListener('app:bizlidaProgress', listener);
    },
    runCheck: () => ipcRenderer.invoke('app:runCheck'),
    getSettings: () => ipcRenderer.invoke('app:getSettings'),
    setSettings: (patch) => ipcRenderer.invoke('app:setSettings', patch),
    generateReport: (reportType, format) => ipcRenderer.invoke('app:generateReport', { reportType, format }),
    openPath: (targetPath) => ipcRenderer.invoke('app:openPath', targetPath)
});
