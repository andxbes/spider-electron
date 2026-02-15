const { contextBridge, ipcRenderer } = require('electron');

// "Белый список" каналов для безопасного взаимодействия
const validSendChannels = ['start-spider'];
const validReceiveChannels = ['spider-result', 'spider-end', 'spider-progress', 'spider-referrers-update'];

// Предоставляем глобальному объекту window в рендерере доступ к API
contextBridge.exposeInMainWorld('api', {
    // Функция для отправки данных из Renderer в Main
    startSpider: (url) => {
        if (validSendChannels.includes('start-spider')) {
            ipcRenderer.send('start-spider', url);
        }
    },
    // Функции для подписки на события от Main в Renderer
    onSpiderResult: (callback) => {
        if (validReceiveChannels.includes('spider-result')) {
            // Обертка для безопасности, чтобы не передавать весь объект event
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
