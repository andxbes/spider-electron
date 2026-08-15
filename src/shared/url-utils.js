const { URL } = require('node:url');

function normalizePageUrl(url) {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
}

function getUrlExtension(url) {
    try {
        const pathname = new URL(url).pathname;
        const lastSegment = pathname.split('/').pop() || '';
        const dotIndex = lastSegment.lastIndexOf('.');
        if (dotIndex <= 0) {
            return '';
        }
        return lastSegment.slice(dotIndex + 1).toLowerCase();
    } catch {
        return '';
    }
}

function getUrlPathnameLower(href) {
    try {
        return new URL(href).pathname.toLowerCase();
    } catch {
        return '';
    }
}

function isSameHost(url, hostname) {
    return new URL(url).hostname === hostname;
}

const EMPTY_IMAGE_URL = 'spider-electron:empty-img';

function isEmptyImageUrl(url) {
    return String(url || '') === EMPTY_IMAGE_URL;
}

function isUnusableImageSrc(href) {
    if (isSkippableHref(href)) {
        return true;
    }
    const value = String(href || '').trim().toLowerCase();
    return value === 'about:blank'
        || value === 'null'
        || value === 'undefined'
        || value === 'n/a';
}

function isSkippableHref(href) {
    const value = String(href || '').trim();
    if (!value) {
        return true;
    }
    const lower = value.toLowerCase();
    return lower.startsWith('javascript:')
        || lower.startsWith('mailto:')
        || lower.startsWith('tel:')
        || lower.startsWith('data:')
        || lower.startsWith('blob:')
        || value === '#';
}

function parseSrcsetUrls(srcset) {
    const raw = String(srcset || '').trim();
    if (!raw) {
        return [];
    }
    const urls = [];
    const seen = new Set();
    for (const part of raw.split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (!url || seen.has(url)) {
            continue;
        }
        seen.add(url);
        urls.push(url);
    }
    return urls;
}

function firstSrcsetUrl(srcset) {
    return parseSrcsetUrls(srcset)[0] || '';
}

function looksLikeJavascriptUrl(href, ext, pathLower) {
    return ext === 'js' || ext === 'mjs' || ext === 'map'
        || pathLower.endsWith('.js')
        || pathLower.endsWith('/js')
        || pathLower.includes('.js/')
        || pathLower.includes('/js/');
}

function isRedirectStatus(status) {
    return status >= 300 && status < 400;
}

function resolveRedirectTarget(fromUrl, locationHeader) {
    if (!locationHeader) {
        return null;
    }
    try {
        return normalizePageUrl(new URL(locationHeader, fromUrl).href);
    } catch {
        return null;
    }
}

function getContentType(response) {
    const raw = response.headers.get('content-type');
    return raw ? raw.split(';')[0].trim().toLowerCase() : '';
}

function isHtmlContent(contentType) {
    if (!contentType) {
        return true;
    }
    return contentType.includes('text/html') || contentType.includes('application/xhtml');
}

module.exports = {
    normalizePageUrl,
    getUrlExtension,
    getUrlPathnameLower,
    isSameHost,
    isSkippableHref,
    isEmptyImageUrl,
    isUnusableImageSrc,
    EMPTY_IMAGE_URL,
    firstSrcsetUrl,
    parseSrcsetUrls,
    looksLikeJavascriptUrl,
    isRedirectStatus,
    resolveRedirectTarget,
    getContentType,
    isHtmlContent,
};
