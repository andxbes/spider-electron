const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { URL } = require('node:url');
const { getSettingsPath, loadSettings, saveSettings } = require('./settings-persistence');
const { registerSessionDumpHandlers, createApplicationMenu } = require('./session-dump');

let mainWindow = null;

// Функція створення головного вікна застосунку
const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        backgroundColor: '#f4f4f5',
        webPreferences: {
            // Шлях до preload-скрипта для безпечної взаємодії з renderer
            preload: path.join(__dirname, '../preload/preload.js'),
        },
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Завантажуємо основний HTML-файл
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Розкоментуйте для відкриття інструментів розробника при старті
    // mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
    registerSessionDumpHandlers(ipcMain);
    createApplicationMenu(() => mainWindow);
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


const {
    startSpider,
    getScanSession,
    clearScanSession,
} = require('./spider-logic');


ipcMain.handle('settings:get', async () => {
    const settings = await loadSettings();
    return { settings, filePath: getSettingsPath() };
});

ipcMain.handle('settings:save', async (_event, settings) => {
    const saved = await saveSettings(settings);
    return { settings: saved, filePath: getSettingsPath() };
});

ipcMain.on('start-spider', (event, payload) => {
    const startUrl = typeof payload === 'string' ? payload : payload.startUrl;
    const options = typeof payload === 'string' ? {} : (payload.options || {});
    console.log(`Отримано запит на сканування, починаючи з: ${startUrl}`, options);
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (browserWindow) {
        startSpider(startUrl, options, browserWindow).catch(err => {
            console.error('Критична помилка в startSpider:', err);
            browserWindow.webContents.send('spider-end', `Помилка: ${err.message}`);
            clearScanSession();
        });
    }
});

ipcMain.handle('spider-pause', () => {
    const session = getScanSession();
    if (session && !session.finished && !session.stopped) {
        session.paused = true;
        session.markPaused();
        session.sendProgress('На паузі');
        return { ok: true };
    }
    return { ok: false };
});

ipcMain.handle('spider-resume', () => {
    const session = getScanSession();
    if (session && !session.finished && !session.stopped && session.paused) {
        session.paused = false;
        session.markResumed();
        session.sendProgress('В процесі...');
        session.pumpQueue();
        return { ok: true };
    }
    return { ok: false };
});

ipcMain.on('spider-stop', () => {
    const session = getScanSession();
    if (session && !session.finished) {
        session.stopped = true;
        session.paused = false;
        session.sendProgress('Зупинка...');
        session.tryFinishOrPump();
    }
});

ipcMain.handle('shell:open-external', async (_event, url) => {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { ok: false };
        }
        await shell.openExternal(url);
        return { ok: true };
    } catch {
        return { ok: false };
    }
});
