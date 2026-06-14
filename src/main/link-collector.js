const { extractElementText } = require('./page-extractors');
const {
    normalizePageUrl,
    getUrlExtension,
    getUrlPathnameLower,
    isSameHost,
    isSkippableHref,
    firstSrcsetUrl,
    looksLikeJavascriptUrl,
} = require('../shared/url-utils');

const OUTLINK_IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff',
]);
const OUTLINK_MEDIA_EXTENSIONS = new Set([
    'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv', 'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a',
]);
const OUTLINK_FONT_EXTENSIONS = new Set(['woff', 'woff2', 'ttf', 'eot', 'otf']);
const OUTLINK_PLUGIN_EXTENSIONS = new Set(['swf', 'flv']);
const OUTLINK_HTML_EXTENSIONS = new Set(['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'shtml']);

function classifyOutlinkKind(href, { element = '', rel = '', as = '' } = {}) {
    const ext = getUrlExtension(href);
    const relLower = String(rel || '').toLowerCase();
    const elementLower = String(element || '').toLowerCase();
    const asLower = String(as || '').toLowerCase();
    const pathLower = getUrlPathnameLower(href);

    if (elementLower === 'script') {
        return 'javascript';
    }
    if (elementLower === 'iframe') {
        return 'html';
    }
    if (elementLower === 'stylesheet') {
        return 'css';
    }
    if (elementLower === 'embed' || elementLower === 'object') {
        return 'plugins';
    }
    if (elementLower === 'video' || elementLower === 'audio') {
        return 'media';
    }
    if (elementLower === 'image' || elementLower === 'icon') {
        return 'images';
    }

    if (asLower === 'script' || looksLikeJavascriptUrl(href, ext, pathLower)) {
        return 'javascript';
    }
    if (asLower === 'style' || elementLower === 'stylesheet' || relLower.includes('stylesheet') || ext === 'css') {
        return 'css';
    }
    if (asLower === 'font' || relLower.includes('font') || OUTLINK_FONT_EXTENSIONS.has(ext)) {
        return 'fonts';
    }
    if (asLower === 'image' || relLower.includes('icon') || relLower.includes('apple-touch-icon') || OUTLINK_IMAGE_EXTENSIONS.has(ext)) {
        return 'images';
    }
    if (OUTLINK_MEDIA_EXTENSIONS.has(ext)) {
        return 'media';
    }
    if (ext === 'xml' || ext === 'rss' || ext === 'atom') {
        return 'xml';
    }
    if (ext === 'pdf') {
        return 'pdf';
    }
    if (OUTLINK_PLUGIN_EXTENSIONS.has(ext)) {
        return 'plugins';
    }
    if (relLower.includes('modulepreload') || relLower.includes('preload') || relLower.includes('prefetch')) {
        if (asLower === 'script' || looksLikeJavascriptUrl(href, ext, pathLower)) {
            return 'javascript';
        }
        if (asLower === 'style' || ext === 'css') {
            return 'css';
        }
        if (asLower === 'font' || OUTLINK_FONT_EXTENSIONS.has(ext)) {
            return 'fonts';
        }
        if (asLower === 'image' || OUTLINK_IMAGE_EXTENSIONS.has(ext)) {
            return 'images';
        }
        if (asLower === 'fetch' || asLower === 'document') {
            return 'html';
        }
        return 'other';
    }
    if (elementLower === 'anchor' || elementLower === 'area') {
        if (!ext || OUTLINK_HTML_EXTENSIONS.has(ext)) {
            return 'html';
        }
    }
    if (asLower === 'fetch' || asLower === 'document') {
        return 'html';
    }
    if (relLower.includes('alternate') || relLower.includes('canonical') || relLower.includes('manifest')) {
        return 'html';
    }
    if (relLower.includes('preconnect') || relLower.includes('dns-prefetch')) {
        return 'other';
    }
    if (elementLower === 'link' && !ext) {
        return 'other';
    }
    if (!ext) {
        if (elementLower === 'anchor' || elementLower === 'area') {
            return 'html';
        }
        return 'other';
    }
    return 'other';
}

function parseAnchorRel(rel) {
    const raw = String(rel || '').trim();
    if (!raw) {
        return {
            rel: '',
            relFollowAllowed: true,
            relIndexAllowed: true,
            relLabel: 'follow',
        };
    }

    const tokens = raw.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const hasNofollow = tokens.includes('nofollow');
    const hasSponsored = tokens.includes('sponsored');
    const hasUgc = tokens.includes('ugc');
    const restricted = hasNofollow || hasSponsored || hasUgc;
    const markers = [
        hasNofollow ? 'nofollow' : '',
        hasSponsored ? 'sponsored' : '',
        hasUgc ? 'ugc' : '',
    ].filter(Boolean);

    return {
        rel: raw,
        relFollowAllowed: !restricted,
        relIndexAllowed: !restricted,
        relLabel: markers.length ? markers.join(', ') : raw,
    };
}

function isAnchorRelContext(context = {}) {
    const element = String(context.element || '').toLowerCase();
    return element === 'anchor' || element === 'area';
}

function formatOutlinkTag({ element = '', rel = '', as = '', tag = '' } = {}) {
    if (tag) {
        return tag;
    }
    const relLower = String(rel || '').toLowerCase().trim();
    const asValue = String(as || '').trim();
    switch (element) {
        case 'anchor':
            return 'a[href]';
        case 'area':
            return 'area[href]';
        case 'script':
            return 'script[src]';
        case 'stylesheet':
            return 'link[rel=stylesheet]';
        case 'icon':
            return 'link[rel=icon]';
        case 'iframe':
            return 'iframe[src]';
        case 'embed':
            return 'embed[src]';
        case 'object':
            return 'object[data]';
        case 'form':
            return 'form[action]';
        case 'image':
            return 'img[src]';
        case 'video':
            return 'video[src]';
        case 'audio':
            return 'audio[src]';
        default:
            break;
    }
    if (relLower.includes('modulepreload')) {
        return 'link[rel=modulepreload]';
    }
    if (relLower.includes('preload')) {
        return asValue ? `link[rel=preload][as=${asValue}]` : 'link[rel=preload]';
    }
    if (relLower.includes('prefetch')) {
        return 'link[rel=prefetch]';
    }
    if (relLower.includes('preconnect')) {
        return 'link[rel=preconnect]';
    }
    if (relLower.includes('dns-prefetch')) {
        return 'link[rel=dns-prefetch]';
    }
    if (relLower) {
        return `link[rel=${relLower.split(/\s+/)[0]}]`;
    }
    return 'link[href]';
}

function isCrawlableLink(link) {
    if (link.external) {
        return false;
    }
    const tag = String(link.tag || '');
    if (tag === 'a[href]' || tag === 'area[href]' || tag === 'form[action]') {
        return true;
    }
    if (tag === 'iframe[src]' && link.kind === 'html') {
        return true;
    }
    return false;
}

function collectPageLinks($, currentUrl, allowedHostname) {
    const links = [];
    const seen = new Set();

    const addLink = (href, text = '', context = {}) => {
        if (isSkippableHref(href)) {
            return;
        }
        try {
            const absoluteUrl = normalizePageUrl(new URL(href, currentUrl).href);
            const tag = formatOutlinkTag(context);
            const kind = classifyOutlinkKind(absoluteUrl, context);
            const relPart = isAnchorRelContext(context)
                ? String(context.rel || '').toLowerCase().trim()
                : '';
            const seenKey = `${tag}\0${relPart}\0${absoluteUrl}`;
            if (seen.has(seenKey)) {
                return;
            }
            seen.add(seenKey);
            const relInfo = isAnchorRelContext(context)
                ? parseAnchorRel(context.rel || '')
                : { rel: '', relFollowAllowed: null, relIndexAllowed: null, relLabel: '' };
            links.push({
                url: absoluteUrl,
                text: String(text || '').trim().slice(0, 200),
                external: !isSameHost(absoluteUrl, allowedHostname),
                kind,
                tag,
                rel: relInfo.rel,
                relFollowAllowed: relInfo.relFollowAllowed,
                relIndexAllowed: relInfo.relIndexAllowed,
                relLabel: relInfo.relLabel,
            });
        } catch {
            // невалідний URL
        }
    };

    $('a[href]').each((_, link) => {
        const el = $(link);
        addLink(el.attr('href'), extractElementText($, link), {
            element: 'anchor',
            rel: el.attr('rel') || '',
        });
    });

    $('area[href]').each((_, area) => {
        const el = $(area);
        addLink(el.attr('href'), el.attr('alt') || 'area', {
            element: 'area',
            rel: el.attr('rel') || '',
        });
    });

    $('link[href]').each((_, link) => {
        const el = $(link);
        const rel = el.attr('rel') || '';
        const relLower = rel.toLowerCase();
        const as = el.attr('as') || '';
        let element = 'link';
        if (relLower.includes('stylesheet')) {
            element = 'stylesheet';
        } else if (relLower.includes('icon') || relLower.includes('apple-touch-icon')) {
            element = 'icon';
        } else if (relLower.includes('modulepreload')) {
            element = 'script';
        } else if (relLower.includes('preload') || relLower.includes('prefetch')) {
            element = as || 'link';
        }
        addLink(el.attr('href'), rel || 'link', { element, rel, as });
    });

    $('script[src]').each((_, script) => {
        addLink($(script).attr('src'), 'script', { element: 'script' });
    });

    $('iframe[src]').each((_, frame) => {
        addLink($(frame).attr('src'), $(frame).attr('title') || 'iframe', { element: 'iframe' });
    });

    $('embed[src]').each((_, embed) => {
        addLink($(embed).attr('src'), 'embed', { element: 'embed' });
    });

    $('object[data]').each((_, object) => {
        addLink($(object).attr('data'), $(object).attr('title') || 'object', { element: 'object' });
    });

    $('form[action]').each((_, form) => {
        addLink($(form).attr('action'), 'form', { element: 'form' });
    });

    $('input[type="image"][src]').each((_, input) => {
        addLink($(input).attr('src'), $(input).attr('alt') || 'input', { tag: 'input[type=image][src]' });
    });

    $('img[src]').each((_, img) => {
        const el = $(img);
        addLink(el.attr('src'), el.attr('alt') || el.attr('title') || 'image', { element: 'image' });
        const srcset = firstSrcsetUrl(el.attr('srcset'));
        if (srcset) {
            addLink(srcset, el.attr('alt') || el.attr('title') || 'image', { tag: 'img[srcset]' });
        }
    });

    $('picture source[srcset], source[src]').each((_, source) => {
        const el = $(source);
        const srcset = firstSrcsetUrl(el.attr('srcset'));
        if (el.attr('src')) {
            addLink(el.attr('src'), 'media', { tag: 'source[src]' });
        }
        if (srcset) {
            addLink(srcset, 'media', { tag: 'source[srcset]' });
        }
    });

    $('video[src]').each((_, video) => {
        addLink($(video).attr('src'), 'video', { element: 'video' });
    });
    $('video source[src]').each((_, source) => {
        addLink($(source).attr('src'), 'video', { tag: 'video>source[src]' });
    });

    $('audio[src]').each((_, audio) => {
        addLink($(audio).attr('src'), 'audio', { element: 'audio' });
    });
    $('audio source[src]').each((_, source) => {
        addLink($(source).attr('src'), 'audio', { tag: 'audio>source[src]' });
    });

    return links;
}

module.exports = {
    classifyOutlinkKind,
    parseAnchorRel,
    formatOutlinkTag,
    isCrawlableLink,
    collectPageLinks,
};
