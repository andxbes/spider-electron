const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');
const { AUTH_TYPES, normalizeAuthSettings } = require('./http-auth');
const { normalizeUserAgentSettings } = require('../shared/user-agents');
const { normalizeRequestDelayMs, DEFAULT_REQUEST_DELAY_MS } = require('./request-delay');

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 50;

const DEFAULT_SETTINGS = {
    useSitemap: false,
    maxPages: 0,
    concurrency: DEFAULT_CONCURRENCY,
    respectRobotsTxt: true,
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
    userAgentPreset: 'spider',
    userAgentCustom: '',
    authType: AUTH_TYPES.NONE,
    authUsername: '',
    authPassword: '',
    authToken: '',
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
        respectRobotsTxt: raw?.respectRobotsTxt !== false,
        requestDelayMs: normalizeRequestDelayMs(raw?.requestDelayMs),
        ...normalizeUserAgentSettings(raw),
        ...normalizeAuthSettings(raw),
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
    normalizeSettings,
    loadSettings,
    saveSettings,
};
