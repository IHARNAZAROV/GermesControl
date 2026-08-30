const { app, BrowserWindow } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { registerIpcHandlers } = require('./src/main/ipcHandlers');

const WINDOW_DEFAULT_SIZE = { width: 1440, height: 900 };
const WINDOW_MIN_SIZE = { width: 1100, height: 700 };

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        ...WINDOW_DEFAULT_SIZE,
        minWidth: WINDOW_MIN_SIZE.width,
        minHeight: WINDOW_MIN_SIZE.height,
        backgroundColor: '#F3F6F3',
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
