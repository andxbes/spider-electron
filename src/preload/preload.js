const { contextBridge, ipcRenderer } = require('electron');

// Білий список каналів для безпечної взаємодії
const validSendChannels = ['start-spider'];
const validReceiveChannels = ['spider-result', 'spider-end', 'spider-progress', 'spider-referrers-update'];
const validInvokeChannels = ['settings:get', 'settings:save'];

// Надаємо renderer доступ до API через window.api
contextBridge.exposeInMainWorld('api', {
    startSpider: (startUrl, options = {}) => {
        if (validSendChannels.includes('start-spider')) {
            ipcRenderer.send('start-spider', { startUrl, options });
        }
    },
    getSettings: () => {
        if (validInvokeChannels.includes('settings:get')) {
            return ipcRenderer.invoke('settings:get');
        }
        return Promise.resolve({ settings: {}, filePath: '' });
    },
    saveSettings: (settings) => {
        if (validInvokeChannels.includes('settings:save')) {
            return ipcRenderer.invoke('settings:save', settings);
        }
        return Promise.resolve({ settings, filePath: '' });
    },
    onSpiderResult: (callback) => {
        if (validReceiveChannels.includes('spider-result')) {
            ipcRenderer.on('spider-result', (event, ...args) => callback(...args));
        }
    },
    onSpiderEnd: (callback) => {
        if (validReceiveChannels.includes('spider-end')) {
            ipcRenderer.on('spider-end', (event, ...args) => callback(...args));
        }
    },
    onSpiderProgress: (callback) => {
        if (validReceiveChannels.includes('spider-progress')) {
            ipcRenderer.on('spider-progress', (event, ...args) => callback(...args));
        }
    },
    onSpiderReferrersUpdate: (callback) => {
        if (validReceiveChannels.includes('spider-referrers-update')) {
            ipcRenderer.on('spider-referrers-update', (event, ...args) => callback(...args));
        }
    },
});
