const { normalizePageUrl } = require('../shared/url-utils');

const visitedUrls = new Set();
const reportedStubUrls = new Set();
const probedDiscoveredUrls = new Set();
let htmlQueue = [];
let mediaQueue = [];
let probeQueue = [];
let maxPagesToVisit = 0;
const robotsCache = new Map();
let scanSession = null;

function isPageLimitReached() {
    return maxPagesToVisit > 0 && visitedUrls.size >= maxPagesToVisit;
}

function tryClaimUrl(url) {
    let normalized;
    try {
        normalized = normalizePageUrl(url);
    } catch {
        return false;
    }
    if (visitedUrls.has(normalized)) {
        return false;
    }
    if (isPageLimitReached()) {
        return false;
    }
    visitedUrls.add(normalized);
    return true;
}

function setMaxPagesToVisit(limit) {
    maxPagesToVisit = limit;
}

function getMaxPagesToVisit() {
    return maxPagesToVisit;
}

function clearQueues() {
    htmlQueue = [];
    mediaQueue = [];
    probeQueue = [];
}

function clearCrawlRuntime() {
    visitedUrls.clear();
    reportedStubUrls.clear();
    probedDiscoveredUrls.clear();
    clearQueues();
    robotsCache.clear();
}

function getScanSession() {
    return scanSession;
}

function setScanSession(session) {
    scanSession = session;
}

function clearScanSession() {
    scanSession = null;
}

module.exports = {
    visitedUrls,
    reportedStubUrls,
    probedDiscoveredUrls,
    getHtmlQueue: () => htmlQueue,
    getMediaQueue: () => mediaQueue,
    getProbeQueue: () => probeQueue,
    robotsCache,
    isPageLimitReached,
    tryClaimUrl,
    setMaxPagesToVisit,
    getMaxPagesToVisit,
    clearQueues,
    clearCrawlRuntime,
    getScanSession,
    setScanSession,
    clearScanSession,
};
