const DEFAULT_SETTINGS = {
    useSitemap: false,
    maxPages: 0,
    concurrency: 3,
    respectRobotsTxt: true,
    requestDelayMs: 500,
    userAgentPreset: 'spider',
    userAgentCustom: '',
    authType: 'none',
    authUsername: '',
    authPassword: '',
    authToken: '',
};

const PERSISTED_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

/** Session-only: sitemap URLs for current window (not written to settings.json). */
let sessionSitemapUrlsText = '';

function getSessionSitemapUrlsText() {
    return sessionSitemapUrlsText;
}

function setSessionSitemapUrlsText(text) {
    sessionSitemapUrlsText = typeof text === 'string' ? text : '';
}

function parseSessionSitemapUrls() {
    const urls = [];
    const seen = new Set();
    for (const line of sessionSitemapUrlsText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        if (seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        urls.push(trimmed);
    }
    return urls;
}

function syncSessionSitemapFromDom() {
    if (typeof document === 'undefined') {
        return;
    }
    const field = document.getElementById('sitemapUrls');
    if (field) {
        setSessionSitemapUrlsText(field.value);
    }
}

/** Snapshot for session dump: persisted settings + session sitemap text. */
async function collectDumpSettings() {
    syncSessionSitemapFromDom();
    const loaded = await loadSettings();
    return {
        ...DEFAULT_SETTINGS,
        ...loaded,
        sitemapUrlsText: getSessionSitemapUrlsText(),
    };
}

function normalizeDumpSettings(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const persisted = {};
    for (const key of PERSISTED_SETTING_KEYS) {
        if (raw[key] !== undefined) {
            persisted[key] = raw[key];
        }
    }
    let sitemapUrlsText = '';
    if (typeof raw.sitemapUrlsText === 'string') {
        sitemapUrlsText = raw.sitemapUrlsText;
    } else if (Array.isArray(raw.sitemapUrls)) {
        sitemapUrlsText = raw.sitemapUrls
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .join('\n');
    }
    return {
        ...DEFAULT_SETTINGS,
        ...persisted,
        sitemapUrlsText,
    };
}

/** Restore settings from dump into settings.json + session sitemap field. */
async function applyDumpSettings(raw) {
    const normalized = normalizeDumpSettings(raw);
    if (!normalized) {
        return false;
    }
    const { sitemapUrlsText, ...persisted } = normalized;
    setSessionSitemapUrlsText(sitemapUrlsText);
    await saveSettings(persisted);
    if (typeof refreshOpenSettingsForms === 'function') {
        refreshOpenSettingsForms();
    } else if (typeof document !== 'undefined') {
        const field = document.getElementById('sitemapUrls');
        if (field) {
            field.value = sitemapUrlsText;
        }
    }
    return true;
}

async function loadSettings() {
    if (window.api?.getSettings) {
        const result = await window.api.getSettings();
        return { ...DEFAULT_SETTINGS, ...result.settings };
    }
    return { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings) {
    if (window.api?.saveSettings) {
        const result = await window.api.saveSettings(settings);
        return result;
    }
    return { settings: { ...DEFAULT_SETTINGS, ...settings }, filePath: '' };
}

async function getSettingsFilePath() {
    if (!window.api?.getSettings) {
        return '';
    }
    const result = await window.api.getSettings();
    return result.filePath || '';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DEFAULT_SETTINGS,
        PERSISTED_SETTING_KEYS,
        getSessionSitemapUrlsText,
        setSessionSitemapUrlsText,
        parseSessionSitemapUrls,
        syncSessionSitemapFromDom,
        collectDumpSettings,
        normalizeDumpSettings,
        applyDumpSettings,
        loadSettings,
        saveSettings,
        getSettingsFilePath,
    };
}
