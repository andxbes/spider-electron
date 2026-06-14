const { normalizePageUrl, isSameHost, getUrlExtension } = require('../shared/url-utils');
const { isCrawlableLink } = require('./link-collector');
const { addReferrer } = require('./crawl-referrers');
const {
    visitedUrls,
    probedDiscoveredUrls,
    getHtmlQueue,
    getMediaQueue,
    getProbeQueue,
    isPageLimitReached,
} = require('./crawl-state');

const MEDIA_URL_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff',
    'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv',
    'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a',
    'pdf', 'zip', 'gz', 'rar', '7z', 'tar',
    'css', 'js', 'mjs', 'map',
    'woff', 'woff2', 'ttf', 'eot', 'otf',
    'xml', 'json', 'txt', 'csv',
]);

function isLikelyMediaUrl(url) {
    return MEDIA_URL_EXTENSIONS.has(getUrlExtension(url));
}

function getQueueLength() {
    return getHtmlQueue().length + getMediaQueue().length + getProbeQueue().length;
}

function isProbeUrlQueued(url) {
    return getProbeQueue().some((item) => item.url === url);
}

function isUrlQueued(url) {
    return getHtmlQueue().some((item) => item.url === url)
        || getMediaQueue().some((item) => item.url === url)
        || isProbeUrlQueued(url);
}

function hasPendingWork() {
    if (getProbeQueue().length > 0) {
        return true;
    }
    if (isPageLimitReached()) {
        return false;
    }
    return getHtmlQueue().length > 0 || getMediaQueue().length > 0;
}

function needsLinkProbe(link) {
    if (link.external) {
        return true;
    }
    return !isCrawlableLink(link);
}

function dequeueNextUrl() {
    if (!isPageLimitReached()) {
        const htmlQueue = getHtmlQueue();
        if (htmlQueue.length > 0) {
            const item = htmlQueue.shift();
            return { type: 'crawl', url: item.url, referrer: item.referrer };
        }
        const mediaQueue = getMediaQueue();
        if (mediaQueue.length > 0) {
            const item = mediaQueue.shift();
            return { type: 'crawl', url: item.url, referrer: item.referrer };
        }
    }
    const probeQueue = getProbeQueue();
    if (probeQueue.length > 0) {
        const item = probeQueue.shift();
        return {
            type: 'probe',
            url: item.url,
            referrer: item.referrer,
            link: item.link,
        };
    }
    return null;
}

function enqueueUrl(url, referrer, allowedHostname, linkMeta = {}) {
    try {
        const absoluteUrl = normalizePageUrl(url);
        if (!isSameHost(absoluteUrl, allowedHostname)) {
            return;
        }

        if (referrer !== 'N/A') {
            addReferrer(absoluteUrl, referrer, linkMeta);
        }

        if (!visitedUrls.has(absoluteUrl) && !isUrlQueued(absoluteUrl)) {
            const targetQueue = isLikelyMediaUrl(absoluteUrl) ? getMediaQueue() : getHtmlQueue();
            targetQueue.push({ url: absoluteUrl, referrer });
        }
    } catch {
        // невалідний URL
    }
}

function enqueueProbeUrl(url, sourceUrl, link) {
    if (!needsLinkProbe(link)) {
        return;
    }
    try {
        const absoluteUrl = normalizePageUrl(url);
        if (probedDiscoveredUrls.has(absoluteUrl) || isProbeUrlQueued(absoluteUrl)) {
            return;
        }
        getProbeQueue().push({ url: absoluteUrl, referrer: sourceUrl, link });
    } catch {
        // невалідний URL
    }
}

module.exports = {
    isLikelyMediaUrl,
    getQueueLength,
    isProbeUrlQueued,
    isUrlQueued,
    hasPendingWork,
    needsLinkProbe,
    dequeueNextUrl,
    enqueueUrl,
    enqueueProbeUrl,
};
