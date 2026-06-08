const fs = require('node:fs/promises');
const path = require('node:path');
const { app, dialog, Menu, BrowserWindow } = require('electron');

const DUMP_VERSION = 1;
const DUMP_FILTER = {
    name: 'Дамп сканування Spider',
    extensions: ['spider.json', 'json'],
};

function defaultDumpFileName() {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `spider-dump-${stamp}.spider.json`;
}

function getWindowFromEvent(event) {
    return BrowserWindow.fromWebContents(event.sender);
}

function validateDump(data) {
    if (!data || typeof data !== 'object') {
        return { ok: false, error: 'Файл порожній або пошкоджений.' };
    }
    if (data.version !== DUMP_VERSION) {
        return { ok: false, error: `Непідтримувана версія дампу: ${data.version}` };
    }
    if (!Array.isArray(data.results)) {
        return { ok: false, error: 'У дампі немає масиву results.' };
    }
    return { ok: true };
}

function registerSessionDumpHandlers(ipcMain) {
    ipcMain.handle('session:save', async (event, payload) => {
        const browserWindow = getWindowFromEvent(event);
        if (!browserWindow) {
            return { ok: false, error: 'Вікно недоступне.' };
        }

        const { canceled, filePath } = await dialog.showSaveDialog(browserWindow, {
            title: 'Зберегти дамп сканування',
            defaultPath: defaultDumpFileName(),
            filters: [DUMP_FILTER],
        });

        if (canceled || !filePath) {
            return { ok: false, canceled: true };
        }

        const dump = {
            version: DUMP_VERSION,
            app: 'spider-electron',
            savedAt: new Date().toISOString(),
            ...payload,
        };

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(dump, null, 2), 'utf-8');
        return { ok: true, filePath };
    });

    ipcMain.handle('session:load', async (event) => {
        const browserWindow = getWindowFromEvent(event);
        if (!browserWindow) {
            return { ok: false, error: 'Вікно недоступне.' };
        }

        const { canceled, filePaths } = await dialog.showOpenDialog(browserWindow, {
            title: 'Завантажити дамп сканування',
            properties: ['openFile'],
            filters: [DUMP_FILTER],
        });

        if (canceled || !filePaths?.[0]) {
            return { ok: false, canceled: true };
        }

        const filePath = filePaths[0];
        let parsed;
        try {
            parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        } catch {
            return { ok: false, error: 'Не вдалося прочитати JSON-файл.' };
        }

        const validation = validateDump(parsed);
        if (!validation.ok) {
            return { ok: false, error: validation.error };
        }

        return { ok: true, filePath, dump: parsed };
    });
}

function createApplicationMenu(getMainWindow) {
    const template = [
        {
            label: 'Файл',
            submenu: [
                {
                    label: 'Зберегти дамп сканування…',
                    accelerator: 'CommandOrControl+Shift+S',
                    click: () => {
                        const win = getMainWindow();
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('session-dump-request-save');
                        }
                    },
                },
                {
                    label: 'Завантажити дамп…',
                    accelerator: 'CommandOrControl+Shift+O',
                    click: async () => {
                        const win = getMainWindow();
                        if (!win || win.isDestroyed()) {
                            return;
                        }
                        const result = await dialog.showOpenDialog(win, {
                            title: 'Завантажити дамп сканування',
                            properties: ['openFile'],
                            filters: [DUMP_FILTER],
                        });
                        if (result.canceled || !result.filePaths?.[0]) {
                            return;
                        }
                        try {
                            const text = await fs.readFile(result.filePaths[0], 'utf-8');
                            const dump = JSON.parse(text);
                            const validation = validateDump(dump);
                            if (!validation.ok) {
                                dialog.showErrorBox('Помилка дампу', validation.error);
                                return;
                            }
                            win.webContents.send('session-dump-loaded', {
                                ok: true,
                                filePath: result.filePaths[0],
                                dump,
                            });
                        } catch (error) {
                            dialog.showErrorBox('Помилка дампу', error.message || 'Не вдалося відкрити файл.');
                        }
                    },
                },
                { type: 'separator' },
                { role: 'quit', label: 'Вихід' },
            ],
        },
        {
            label: 'Вигляд',
            submenu: [
                { role: 'reload', label: 'Перезавантажити' },
                { role: 'toggleDevTools', label: 'Інструменти розробника' },
            ],
        },
    ];

    if (process.platform === 'darwin') {
        template.unshift({
            label: app.getName(),
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit', label: 'Завершити Spider' },
            ],
        });
    }

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = {
    DUMP_VERSION,
    registerSessionDumpHandlers,
    createApplicationMenu,
    validateDump,
};
