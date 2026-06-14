const ROBOTS_UA = 'MyElectronSpider/1.0';

function buildSpiderResult(overrides) {
    return {
        metaDescription: '',
        metaCanonical: '',
        contentType: '',
        metaRobots: '',
        metaRobotsStatus: 'none',
        metaRobotsLabel: '',
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
    const allowed = robots.isAllowed(url, ROBOTS_UA);
    if (allowed === undefined) {
        return {
            robotsAllowed: null,
            robotsRule: '—',
        };
    }

    const lineNumber = robots.getMatchingLineNumber(url, ROBOTS_UA);
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

function buildResultWithIndexing(robots, robotsText, url, fields, metaRobotsRaw = null) {
    const metaFields = metaRobotsRaw === null
        ? {
            metaRobots: '',
            metaRobotsStatus: 'none',
            metaRobotsLabel: '',
            blocksFollow: false,
        }
        : parseMetaRobotsDirective(metaRobotsRaw);

    return buildSpiderResult({
        ...getRobotsTxtInfo(robots, robotsText, url),
        ...metaFields,
        ...fields,
    });
}

module.exports = {
    ROBOTS_UA,
    buildSpiderResult,
    parseMetaRobotsDirective,
    getRobotsTxtInfo,
    buildResultWithIndexing,
};
