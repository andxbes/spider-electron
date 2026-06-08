const DEFAULT_SETTINGS = {
    useSitemap: false,
    maxPages: 0,
    lastStartUrl: '',
};

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
