const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 20;

const DEFAULT_SETTINGS = {
    useSitemap: false,
    maxPages: 0,
    concurrency: DEFAULT_CONCURRENCY,
};

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeSettings(raw) {
    const concurrency = parseInt(raw?.concurrency, 10);
    return {
        useSitemap: Boolean(raw?.useSitemap),
        maxPages: Math.max(0, parseInt(raw?.maxPages, 10) || 0),
        concurrency: Math.min(
            MAX_CONCURRENCY,
            Math.max(1, Number.isNaN(concurrency) ? DEFAULT_CONCURRENCY : concurrency)
        ),
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
    DEFAULT_CONCURRENCY,
    MAX_CONCURRENCY,
    getSettingsPath,
    loadSettings,
    saveSettings,
};
