const robotsParser = require('robots-parser');
const { fetch: undiciFetch } = require('undici');
const { normalizePageUrl, isSameHost } = require('../shared/url-utils');
const { getAuthHeadersForUrl } = require('./http-auth');
const { emitSpiderResult } = require('./crawl-hooks');
const { robotsCache, getRespectRobotsTxt } = require('./crawl-state');
const {
    getActiveRobotsUserAgent,
    setActiveRobotsUserAgent,
    buildSpiderResult,
    buildResultWithIndexing,
    getRobotsTxtInfo,
} = require('./crawl-results');
const { DEFAULT_USER_AGENT } = require('../shared/user-agents');
const {
    setScanRequestDelayMs,
    clearScanRequestDelayMs,
    waitBeforeRequest,
} = require('./request-delay');

const FETCH_TIMEOUT_MS = 20_000;
const { MAX_REDIRECT_HOPS } = require('../shared/redirect-chain');

let fetchImpl = undiciFetch;
let scanAuthContext = null;
let scanUserAgent = DEFAULT_USER_AGENT;

function setScanAuthContext(context) {
    scanAuthContext = context;
}

function clearScanAuthContext() {
    scanAuthContext = null;
}

function getScanAuthContext() {
    return scanAuthContext;
}

function setScanUserAgent(userAgent) {
    scanUserAgent = String(userAgent || '').trim() || DEFAULT_USER_AGENT;
    setActiveRobotsUserAgent(scanUserAgent);
}

function getScanUserAgent() {
    return scanUserAgent;
}

function clearScanUserAgent() {
    setScanUserAgent(DEFAULT_USER_AGENT);
}

function setFetchForTests(fn) {
    fetchImpl = fn;
}

function resetFetchForTests() {
    fetchImpl = undiciFetch;
}

async function fetchPage(url, { skipDelay = false, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
    if (!skipDelay) {
        await waitBeforeRequest();
    }
    const authHeaders = scanAuthContext
        ? getAuthHeadersForUrl(url, scanAuthContext.hostname, scanAuthContext)
        : {};
    const timeout = Math.max(1, Number(timeoutMs) || FETCH_TIMEOUT_MS);
    return fetchImpl(url, {
        signal: AbortSignal.timeout(timeout),
        redirect: 'manual',
        headers: { 'User-Agent': getScanUserAgent(), ...authHeaders },
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

function shouldBlockByRobotsTxt(parser, url) {
    if (!getRespectRobotsTxt()) {
        return false;
    }
    return !parser.isAllowed(url, getActiveRobotsUserAgent());
}

async function isInternalRobotsDisallowed(url, allowedHostname) {
    if (!getRespectRobotsTxt()) {
        return false;
    }
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
    DEFAULT_USER_AGENT,
    getScanUserAgent,
    setScanUserAgent,
    clearScanUserAgent,
    setScanRequestDelayMs,
    clearScanRequestDelayMs,
    FETCH_TIMEOUT_MS,
    MAX_REDIRECT_HOPS,
    setFetchForTests,
    resetFetchForTests,
    setScanAuthContext,
    clearScanAuthContext,
    getScanAuthContext,
    fetchPage,
    timedFetch,
    getRobots,
    getRobotsTxtFieldsForUrl,
    isInternalRobotsDisallowed,
    shouldBlockByRobotsTxt,
    sendRobotsBlockedResult,
};
