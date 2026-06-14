const path = require('path');

let electronApp;
try {
    ({ app: electronApp } = require('electron'));
} catch {
    electronApp = null;
}

const pkg = require(path.join(__dirname, '../../package.json'));

const APP_DISPLAY_NAME = 'Electron Web Spider';
const ABOUT_AUTHOR = 'andxbes';
const ABOUT_EMAIL = 'andxbes@gmail.com';

function getAppVersion() {
    if (electronApp && typeof electronApp.getVersion === 'function') {
        const version = electronApp.getVersion();
        if (version) {
            return version;
        }
    }
    return pkg.version;
}

function getAboutInfo() {
    return {
        name: APP_DISPLAY_NAME,
        version: getAppVersion(),
        author: ABOUT_AUTHOR,
        email: ABOUT_EMAIL,
    };
}

function registerAboutHandlers(ipcMain) {
    ipcMain.handle('app:getAbout', () => getAboutInfo());
}

function sendAboutShow(win) {
    if (win && !win.isDestroyed()) {
        win.webContents.send('about-show');
    }
}

module.exports = {
    getAboutInfo,
    registerAboutHandlers,
    sendAboutShow,
};
