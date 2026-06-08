const { contextBridge, ipcRenderer } = require('electron');

const validSendChannels = ['start-spider', 'spider-stop'];
const validReceiveChannels = ['spider-result', 'spider-end', 'spider-progress', 'spider-referrers-update'];
const validInvokeChannels = ['settings:get', 'settings:save', 'shell:open-external', 'spider-pause', 'spider-resume'];

contextBridge.exposeInMainWorld('api', {
    startSpider: (startUrl, options = {}) => {
        if (validSendChannels.includes('start-spider')) {
            ipcRenderer.send('start-spider', { startUrl, options });
        }
    },
    pauseSpider: () => {
        if (validInvokeChannels.includes('spider-pause')) {
            return ipcRenderer.invoke('spider-pause');
        }
        return Promise.resolve({ ok: false });
    },
    resumeSpider: () => {
        if (validInvokeChannels.includes('spider-resume')) {
            return ipcRenderer.invoke('spider-resume');
        }
        return Promise.resolve({ ok: false });
    },
    stopSpider: () => {
        if (validSendChannels.includes('spider-stop')) {
            ipcRenderer.send('spider-stop');
        }
    },
    openExternal: (url) => {
        if (validInvokeChannels.includes('shell:open-external')) {
            return ipcRenderer.invoke('shell:open-external', url);
        }
        return Promise.resolve({ ok: false });
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
