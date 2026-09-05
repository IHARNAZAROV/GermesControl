const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./src/main/ipcHandlers');

const WINDOW_DEFAULT_SIZE = { width: 1440, height: 900 };
const WINDOW_MIN_SIZE = { width: 1100, height: 700 };
const APP_ICON_PATH = path.join(__dirname, 'render', 'accets', 'icon.ico');

let mainWindow = null;

function loadAppIcon() {
    const sourceIcon = nativeImage.createFromPath(APP_ICON_PATH);
    if (sourceIcon.isEmpty()) {
        throw new Error(`Не удалось загрузить иконку приложения: ${APP_ICON_PATH}`);
    }

    return sourceIcon.resize({
        width: 32,
        height: 32,
        quality: 'best'
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        ...WINDOW_DEFAULT_SIZE,
        minWidth: WINDOW_MIN_SIZE.width,
        minHeight: WINDOW_MIN_SIZE.height,
        backgroundColor: '#F3F6F3',
        icon: loadAppIcon(),
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
