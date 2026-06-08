const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

const DEFAULT_SETTINGS = {
    useSitemap: false,
    maxPages: 0,
    lastStartUrl: '',
};

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeSettings(raw) {
    return {
        useSitemap: Boolean(raw?.useSitemap),
        maxPages: Math.max(0, parseInt(raw?.maxPages, 10) || 0),
        lastStartUrl: typeof raw?.lastStartUrl === 'string' ? raw.lastStartUrl : '',
    };
}

async function loadSettings() {
    try {
        const filePath = getSettingsPath();
        const text = await fs.readFile(filePath, 'utf-8');
        return normalizeSettings(JSON.parse(text));
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

async function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    const filePath = getSettingsPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
    return normalized;
}

module.exports = {
    DEFAULT_SETTINGS,
    getSettingsPath,
    loadSettings,
    saveSettings,
};
