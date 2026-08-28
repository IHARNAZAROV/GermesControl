const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./src/main/ipcHandlers');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: '#F5F6FA',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'render', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

registerIpcHandlers(() => mainWindow);

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
