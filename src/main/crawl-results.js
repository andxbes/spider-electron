const { getXRobotsTag, collectResponseHeaders } = require('./page-extractors');

const DEFAULT_ROBOTS_UA = 'MyElectronSpider/1.0';
let activeRobotsUa = DEFAULT_ROBOTS_UA;

function setActiveRobotsUserAgent(userAgent) {
    activeRobotsUa = String(userAgent || '').trim() || DEFAULT_ROBOTS_UA;
}

function getActiveRobotsUserAgent() {
    return activeRobotsUa;
}

function buildSpiderResult(overrides) {
    return {
        metaDescription: '',
        metaCanonical: '',
        contentType: '',
        metaRobots: '',
        metaRobotsStatus: 'none',
        metaRobotsLabel: '',
        xRobotsTag: '',
        xRobotsTagStatus: 'none',
        xRobotsTagLabel: '',
        responseHeaders: [],
        robotsAllowed: null,
        robotsRule: '',
        responseTimeMs: null,
        external: false,
        fetched: true,
        kind: '',
        tag: '',
        headings: [],
        ...overrides,
    };
}

function parseMetaRobotsDirective(content) {
    const raw = String(content || '').trim();
    if (!raw) {
        return {
            metaRobots: '',
            metaRobotsStatus: 'allowed',
            metaRobotsLabel: 'index, follow',
            blocksFollow: false,
        };
    }

    const tokens = raw.toLowerCase().split(/[,;\s]+/).filter(Boolean);
    const hasNoindex = tokens.includes('noindex');
    const hasNofollow = tokens.includes('nofollow');

    if (hasNoindex && hasNofollow) {
        return {
            metaRobots: raw,
            metaRobotsStatus: 'closed',
            metaRobotsLabel: raw,
            blocksFollow: true,
        };
    }
    if (hasNoindex) {
        return {
            metaRobots: raw,
            metaRobotsStatus: 'noindex',
            metaRobotsLabel: raw,
            blocksFollow: false,
        };
    }
    if (hasNofollow) {
        return {
            metaRobots: raw,
            metaRobotsStatus: 'nofollow',
            metaRobotsLabel: raw,
            blocksFollow: true,
        };
    }

    return {
        metaRobots: raw,
        metaRobotsStatus: 'allowed',
        metaRobotsLabel: raw,
        blocksFollow: false,
    };
}

function getRobotsTxtInfo(robots, robotsText, url) {
    const robotsUa = getActiveRobotsUserAgent();
    const allowed = robots.isAllowed(url, robotsUa);
    if (allowed === undefined) {
        return {
            robotsAllowed: null,
            robotsRule: '—',
        };
    }

    const lineNumber = robots.getMatchingLineNumber(url, robotsUa);
    let robotsRule = '';

    if (lineNumber > 0 && robotsText) {
        const line = robotsText.split('\n')[lineNumber - 1];
        robotsRule = line ? line.trim() : '';
    } else if (allowed) {
        robotsRule = 'немає правила (дозволено)';
    } else {
        robotsRule = 'заборонено';
    }

    return {
        robotsAllowed: allowed,
        robotsRule,
    };
}

function getResponseHeaderFields(response) {
    if (!response?.headers) {
        return {
            responseHeaders: [],
            xRobotsTag: '',
            xRobotsTagStatus: 'none',
            xRobotsTagLabel: '',
        };
    }

    const raw = getXRobotsTag(response).trim();
    const parsed = raw ? parseMetaRobotsDirective(raw) : null;

    return {
        responseHeaders: collectResponseHeaders(response),
        xRobotsTag: parsed?.metaRobots || '',
        xRobotsTagStatus: parsed ? parsed.metaRobotsStatus : 'none',
        xRobotsTagLabel: parsed ? parsed.metaRobotsLabel : '',
    };
}

function buildResultWithIndexing(robots, robotsText, url, fields, metaRobotsRaw = null, response = null) {
    const metaParsed = metaRobotsRaw === null
        ? {
            metaRobots: '',
            metaRobotsStatus: 'none',
            metaRobotsLabel: '',
        }
        : parseMetaRobotsDirective(metaRobotsRaw);

    const { blocksFollow: _blocksFollow, ...metaFields } = metaParsed;

    return buildSpiderResult({
        ...getRobotsTxtInfo(robots, robotsText, url),
        ...metaFields,
        ...getResponseHeaderFields(response),
        ...fields,
    });
}

module.exports = {
    DEFAULT_ROBOTS_UA,
    getActiveRobotsUserAgent,
    setActiveRobotsUserAgent,
    buildSpiderResult,
    parseMetaRobotsDirective,
    getRobotsTxtInfo,
    buildResultWithIndexing,
    getResponseHeaderFields,
};
