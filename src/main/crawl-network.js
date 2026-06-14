const robotsParser = require('robots-parser');
const { fetch: undiciFetch } = require('undici');
const { normalizePageUrl, isSameHost } = require('../shared/url-utils');
const { emitSpiderResult } = require('./crawl-hooks');
const { robotsCache } = require('./crawl-state');
const {
    ROBOTS_UA,
    buildSpiderResult,
    buildResultWithIndexing,
    getRobotsTxtInfo,
} = require('./crawl-results');

const USER_AGENT = 'MyElectronSpider/1.0 (+https://github.com/your-repo)';
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECT_HOPS = 10;

let fetchImpl = undiciFetch;

function setFetchForTests(fn) {
    fetchImpl = fn;
}

function resetFetchForTests() {
    fetchImpl = undiciFetch;
}

function fetchPage(url) {
    return fetchImpl(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT },
    });
}

async function timedFetch(url) {
    const startedAt = performance.now();
    const response = await fetchPage(url);
    return {
        response,
        getElapsedMs() {
            return Math.round(performance.now() - startedAt);
        },
    };
}

async function getRobots(urlObject) {
    const host = urlObject.host;
    if (robotsCache.has(host)) {
        return robotsCache.get(host);
    }

    const robotsUrl = `${urlObject.protocol}//${urlObject.host}/robots.txt`;
    let text = '';
    try {
        const response = await fetchPage(robotsUrl);
        if (response.ok) {
            text = await response.text();
        }
    } catch {
        // robots.txt відсутній — вважаємо все дозволеним
    }

    const entry = {
        parser: robotsParser(robotsUrl, text),
        text,
    };
    robotsCache.set(host, entry);
    return entry;
}

async function getRobotsTxtFieldsForUrl(url) {
    try {
        const urlObject = new URL(url);
        const { parser, text } = await getRobots(urlObject);
        return getRobotsTxtInfo(parser, text, url);
    } catch {
        return {
            robotsAllowed: null,
            robotsRule: '',
        };
    }
}

async function isInternalRobotsDisallowed(url, allowedHostname) {
    try {
        const absoluteUrl = normalizePageUrl(url);
        if (!isSameHost(absoluteUrl, allowedHostname)) {
            return false;
        }
        const fields = await getRobotsTxtFieldsForUrl(absoluteUrl);
        return fields.robotsAllowed === false;
    } catch {
        return false;
    }
}

function sendRobotsBlockedResult(browserWindow, robots, robotsText, url, referrers) {
    console.log(`Заблоковано robots.txt: ${url}`);
    emitSpiderResult(browserWindow, buildResultWithIndexing(
        robots,
        robotsText,
        url,
        {
            status: 0,
            url,
            title: '',
            referrers,
        }
    ));
}

module.exports = {
    USER_AGENT,
    ROBOTS_UA,
    FETCH_TIMEOUT_MS,
    MAX_REDIRECT_HOPS,
    setFetchForTests,
    resetFetchForTests,
    fetchPage,
    timedFetch,
    getRobots,
    getRobotsTxtFieldsForUrl,
    isInternalRobotsDisallowed,
    sendRobotsBlockedResult,
};
