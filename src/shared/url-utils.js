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

function firstSrcsetUrl(srcset) {
    const first = String(srcset || '').split(',')[0]?.trim().split(/\s+/)[0];
    return first || '';
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
    firstSrcsetUrl,
    looksLikeJavascriptUrl,
    isRedirectStatus,
    resolveRedirectTarget,
    getContentType,
    isHtmlContent,
};
