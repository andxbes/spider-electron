/**
 * User-Agent presets for crawl requests and robots.txt matching.
 */
(function initUserAgents(root) {
    const DEFAULT_USER_AGENT = 'MyElectronSpider/1.0';
    const DEFAULT_USER_AGENT_PRESET_ID = 'spider';
    const CUSTOM_USER_AGENT_PRESET_ID = 'custom';

    const USER_AGENT_PRESETS = [
        {
            id: 'spider',
            label: 'MyElectronSpider (за замовч.)',
            value: DEFAULT_USER_AGENT,
            group: 'crawler',
        },
        {
            id: 'chrome-win',
            label: 'Google Chrome (Windows)',
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            group: 'browser',
        },
        {
            id: 'chrome-mac',
            label: 'Google Chrome (macOS)',
            value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            group: 'browser',
        },
        {
            id: 'firefox-win',
            label: 'Mozilla Firefox (Windows)',
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
            group: 'browser',
        },
        {
            id: 'safari-mac',
            label: 'Safari (macOS)',
            value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
            group: 'browser',
        },
        {
            id: 'edge-win',
            label: 'Microsoft Edge (Windows)',
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
            group: 'browser',
        },
        {
            id: 'googlebot',
            label: 'Googlebot',
            value: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            group: 'search',
        },
        {
            id: 'bingbot',
            label: 'Bingbot',
            value: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
            group: 'search',
        },
        {
            id: 'yandexbot',
            label: 'YandexBot',
            value: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
            group: 'search',
        },
        {
            id: 'duckduckbot',
            label: 'DuckDuckBot',
            value: 'DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)',
            group: 'search',
        },
        {
            id: CUSTOM_USER_AGENT_PRESET_ID,
            label: 'Власний User-Agent',
            value: '',
            group: 'custom',
        },
    ];

    const PRESET_IDS = new Set(USER_AGENT_PRESETS.map((preset) => preset.id));

    function isValidUserAgentPresetId(id) {
        return PRESET_IDS.has(id);
    }

    function getUserAgentPreset(id) {
        return USER_AGENT_PRESETS.find((preset) => preset.id === id) || null;
    }

    function normalizeUserAgentSettings(raw) {
        const presetId = String(raw?.userAgentPreset || DEFAULT_USER_AGENT_PRESET_ID).trim();
        return {
            userAgentPreset: isValidUserAgentPresetId(presetId)
                ? presetId
                : DEFAULT_USER_AGENT_PRESET_ID,
            userAgentCustom: String(raw?.userAgentCustom || '').trim(),
        };
    }

    function resolveUserAgent(raw) {
        const { userAgentPreset, userAgentCustom } = normalizeUserAgentSettings(raw);
        if (userAgentPreset === CUSTOM_USER_AGENT_PRESET_ID) {
            return userAgentCustom || DEFAULT_USER_AGENT;
        }
        const preset = getUserAgentPreset(userAgentPreset);
        return preset?.value || DEFAULT_USER_AGENT;
    }

    const exported = {
        DEFAULT_USER_AGENT,
        DEFAULT_USER_AGENT_PRESET_ID,
        CUSTOM_USER_AGENT_PRESET_ID,
        USER_AGENT_PRESETS,
        isValidUserAgentPresetId,
        getUserAgentPreset,
        normalizeUserAgentSettings,
        resolveUserAgent,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
    Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : {});
