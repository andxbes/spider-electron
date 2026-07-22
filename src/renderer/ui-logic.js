/* eslint-disable no-redeclare */
(function initUiLogic(root) {
if (typeof require !== 'undefined') {
    try {
        require('../shared/redirect-chain');
    } catch {
        // redirect-chain.js підключається окремим <script> у renderer
    }
}
const OUTLINK_KIND_LABELS = {
    html: 'HTML',
    javascript: 'JavaScript',
    css: 'CSS',
    images: 'Images',
    media: 'Media (зображення, відео, аудіо)',
    fonts: 'Fonts',
    xml: 'XML',
    pdf: 'PDF',
    plugins: 'Plugins',
    other: 'Other (інше / невідоме)',
    unknown: 'Unknown',
};

const OUTLINK_IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff',
]);
const OUTLINK_MEDIA_EXTENSIONS = new Set([
    'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv', 'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a',
]);
const OUTLINK_FONT_EXTENSIONS = new Set(['woff', 'woff2', 'ttf', 'eot', 'otf']);
const OUTLINK_PLUGIN_EXTENSIONS = new Set(['swf', 'flv']);
const OUTLINK_HTML_EXTENSIONS = new Set(['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'shtml']);

function passesSourceFilterForRowImpl(data, activeSourceFilter = 'all', scanHostname = '') {
    if (activeSourceFilter === 'all') {
        return true;
    }
    const external = isExternalLinkImpl(data, scanHostname);
    if (activeSourceFilter === 'external') {
        return external;
    }
    if (activeSourceFilter === 'internal') {
        return !external;
    }
    return true;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function statusRowClass(status) {
    if (status === 200) return 'text-green-700';
    if (status === 0 || status === 'SKIPPED') return 'text-yellow-700';
    if (status === 'ERROR' || (typeof status === 'number' && status >= 400)) return 'text-red-700';
    if (typeof status === 'number' && status >= 300 && status < 400) return 'text-blue-700';
    return 'text-zinc-600';
}

function indexingStateClass(kind, status, allowed) {
    if (kind === 'meta') {
        if (status === 'none') return 'text-zinc-400';
        if (status === 'allowed') return 'text-green-700';
        return 'text-red-700';
    }
    if (allowed === null || allowed === undefined) return 'text-zinc-400';
    return allowed ? 'text-green-700' : 'text-red-700';
}

function metaRobotsCellHtml(data) {
    const status = data.metaRobotsStatus || 'none';
    if (status === 'none') {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const label = data.metaRobotsLabel || data.metaRobots || 'index, follow';
    const cls = indexingStateClass('meta', status);
    const title = status === 'allowed'
        ? 'Дозволено для індексації та обходу'
        : 'Закрито (noindex / nofollow)';
    return `<span class="${cls} font-medium" title="${escapeHtml(title)}: ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

function xRobotsTagCellHtml(data) {
    const status = data.xRobotsTagStatus || 'none';
    if (status === 'none') {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const label = data.xRobotsTagLabel || data.xRobotsTag || '';
    const cls = indexingStateClass('meta', status);
    const title = status === 'allowed'
        ? 'Дозволено для індексації та обходу (X-Robots-Tag)'
        : 'Закрито (X-Robots-Tag: noindex / nofollow)';
    return `<span class="${cls} font-medium" title="${escapeHtml(title)}: ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

function formatResponseTimeMs(ms) {
    if (ms === null || ms === undefined || Number.isNaN(ms)) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const value = Number(ms);
    let cls = 'text-green-700';
    if (value >= 3000) {
        cls = 'text-red-700';
    } else if (value >= 1000) {
        cls = 'text-amber-600';
    }
    return `<span class="font-mono font-medium ${cls}">${value}</span>`;
}

function robotsTxtCellHtml(data) {
    if (data.robotsAllowed === null && !data.robotsRule) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const allowed = data.robotsAllowed !== false;
    const rule = data.robotsRule || (allowed ? 'Дозволено' : 'Заборонено');
    const cls = indexingStateClass('robots', null, data.robotsAllowed);
    const title = allowed ? `Дозволено: ${rule}` : `Заборонено: ${rule}`;
    return `<span class="${cls} font-medium" title="${escapeHtml(title)}">${escapeHtml(rule)}</span>`;
}

function statusSortValue(status) {
    if (typeof status === 'number') return status;
    if (status === 'ERROR') return 10000;
    if (status === 'SKIPPED') return 9999;
    return 5000;
}

function metaRobotsSortValue(data) {
    const status = data.metaRobotsStatus || 'none';
    if (status === 'none') return 0;
    if (status === 'allowed') return 1;
    return 2;
}

function xRobotsTagSortValue(data) {
    const status = data.xRobotsTagStatus || 'none';
    if (status === 'none') return 0;
    if (status === 'allowed') return 1;
    return 2;
}

function robotsTxtSortValue(data) {
    if (data.robotsAllowed === null && !data.robotsRule) return 0;
    if (data.robotsAllowed !== false) return 1;
    return 2;
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

function isHtmlContentType(contentType) {
    const ct = (contentType || '').toLowerCase();
    return ct.includes('text/html') || ct.includes('application/xhtml');
}

function mapKindToFilterKind(kind) {
    const normalized = normalizeLinkKind(kind);
    if (normalized === 'images') {
        return 'media';
    }
    if (normalized === 'html' || normalized === 'javascript' || normalized === 'css' || normalized === 'media') {
        return normalized;
    }
    return null;
}

function isJavascriptResource(data) {
    if (inferLinkKind(data) === 'javascript') {
        return true;
    }
    const contentType = (data.contentType || '').toLowerCase();
    return contentType.includes('javascript') || contentType.includes('ecmascript');
}

function isCssResource(data) {
    if (inferLinkKind(data) === 'css') {
        return true;
    }
    return (data.contentType || '').toLowerCase() === 'text/css';
}

function isMediaResource(data) {
    const inferred = inferLinkKind(data);
    if (inferred === 'images' || inferred === 'media') {
        return true;
    }
    const crawled = getCrawledResourceKind(data);
    return crawled === 'media';
}

function matchesResourceTypeFilterImpl(data, activeContentFilter = 'all') {
    if (activeContentFilter === 'all') {
        return true;
    }
    if (activeContentFilter === 'html') {
        return !isDiscoveredOnly(data) && isHtmlContentType(data.contentType || '');
    }
    if (activeContentFilter === 'javascript') {
        return isJavascriptResource(data);
    }
    if (activeContentFilter === 'css') {
        return isCssResource(data);
    }
    if (activeContentFilter === 'media') {
        return isMediaResource(data);
    }
    return false;
}

function getCrawledResourceKind(data) {
    const contentType = (data.contentType || '').toLowerCase();
    const url = data.url || '';
    const ext = getUrlExtension(url);
    const pathLower = getUrlPathnameLower(url);

    if (isHtmlContentType(contentType)) {
        return 'html';
    }
    if (contentType.includes('javascript') || contentType.includes('ecmascript')) {
        return 'javascript';
    }
    if (contentType === 'text/css') {
        return 'css';
    }
    if (
        contentType.startsWith('image/')
        || contentType.startsWith('video/')
        || contentType.startsWith('audio/')
    ) {
        return 'media';
    }

    if (looksLikeJavascriptUrl(url, ext, pathLower)) {
        return 'javascript';
    }
    if (ext === 'css') {
        return 'css';
    }
    if (OUTLINK_IMAGE_EXTENSIONS.has(ext) || OUTLINK_MEDIA_EXTENSIONS.has(ext)) {
        return 'media';
    }

    return null;
}

function isDiscoveredOnly(data) {
    if (data.fetched === false) {
        return true;
    }
    if (data.fetched === true) {
        return false;
    }
    return data.status === '' && !data.contentType;
}

function shouldHavePageTitle(data) {
    if (isJavascriptResource(data) || isCssResource(data) || isMediaResource(data)) {
        return false;
    }
    if (isDiscoveredOnly(data)) {
        return false;
    }
    const contentType = data.contentType || '';
    if (contentType && !isHtmlContentType(contentType)) {
        return false;
    }
    return true;
}

function getPageTitle(data) {
    if (!shouldHavePageTitle(data)) {
        return '';
    }
    return String(data.title || '').trim();
}

function getResourceKind(data) {
    if (isJavascriptResource(data)) {
        return 'javascript';
    }
    if (isCssResource(data)) {
        return 'css';
    }
    if (isMediaResource(data)) {
        return 'media';
    }
    if (!isDiscoveredOnly(data) && isHtmlContentType(data.contentType || '')) {
        return 'html';
    }
    const explicit = mapKindToFilterKind(data.kind || '');
    if (explicit) {
        return explicit;
    }
    if (!isDiscoveredOnly(data)) {
        return getCrawledResourceKind(data);
    }
    return mapKindToFilterKind(inferLinkKind(data));
}

function getResourceType(data) {
    return getResourceKind(data);
}

function isExternalUrlImpl(url, scanHostname = '') {
    const host = scanHostname;
    if (!host) {
        return false;
    }
    try {
        return new URL(url).hostname !== host;
    } catch {
        return false;
    }
}

function buildOutgoingLink(ref, targetEntry) {
    const edgeHasRelMeta = Boolean(ref.rel)
        || ref.relFollowAllowed !== null
        || ref.relIndexAllowed !== null
        || Boolean(ref.relLabel);
    return normalizeLinkEntryImpl({
        ...targetEntry,
        url: targetEntry.url,
        text: ref.text || targetEntry.text || '',
        tag: ref.tag || targetEntry.tag || '',
        kind: ref.kind || targetEntry.kind || '',
        rel: edgeHasRelMeta ? (ref.rel || '') : (targetEntry.rel || ''),
        relFollowAllowed: edgeHasRelMeta
            ? (ref.relFollowAllowed ?? null)
            : (targetEntry.relFollowAllowed ?? null),
        relIndexAllowed: edgeHasRelMeta
            ? (ref.relIndexAllowed ?? null)
            : (targetEntry.relIndexAllowed ?? null),
        relLabel: edgeHasRelMeta ? (ref.relLabel || '') : (targetEntry.relLabel || ''),
    });
}

function matchesStatusFilter(status, filter) {
    if (filter === 'all') {
        return true;
    }
    if (filter === '2xx') {
        return typeof status === 'number' && status >= 200 && status < 300;
    }
    if (filter === '3xx') {
        return typeof status === 'number' && status >= 300 && status < 400;
    }
    if (filter === '4xx') {
        return typeof status === 'number' && status >= 400 && status < 500;
    }
    if (filter === '5xx') {
        return typeof status === 'number' && status >= 500 && status < 600;
    }
    return String(status) === filter;
}

function isMetaRobotsBlocked(data) {
    const status = data.metaRobotsStatus || 'none';
    return ['noindex', 'nofollow', 'closed'].includes(status);
}

function isXRobotsTagBlocked(data) {
    const status = data.xRobotsTagStatus || 'none';
    return ['noindex', 'nofollow', 'closed'].includes(status);
}

function isRobotsTxtBlocked(data) {
    return data.robotsAllowed === false;
}

function isIndexingBlocked(data) {
    return isMetaRobotsBlocked(data) || isXRobotsTagBlocked(data) || isRobotsTxtBlocked(data);
}

function isIndexingAllowed(data) {
    if (isIndexingBlocked(data)) {
        return false;
    }
    if (data.robotsAllowed !== true) {
        return false;
    }
    const metaStatus = data.metaRobotsStatus || 'none';
    const xStatus = data.xRobotsTagStatus || 'none';
    if (xStatus !== 'none' && xStatus !== 'allowed') {
        return false;
    }
    return metaStatus === 'allowed';
}

function getH1Count(data) {
    return (data.headings || []).filter((heading) => heading.level === 1).length;
}

function normalizeReferrerEntry(item) {
    if (typeof item === 'string') {
        return {
            href: item,
            text: '',
            rel: '',
            tag: '',
            kind: '',
            relFollowAllowed: null,
            relIndexAllowed: null,
            relLabel: '',
        };
    }
    return {
        href: String(item?.href || '').trim(),
        text: String(item?.text || '').trim(),
        rel: item?.rel || '',
        tag: item?.tag || '',
        kind: item?.kind || '',
        relFollowAllowed: item?.relFollowAllowed ?? null,
        relIndexAllowed: item?.relIndexAllowed ?? null,
        relLabel: item?.relLabel || '',
        imgAltMissing: item?.imgAltMissing === true,
        ...(item?.imgAlt !== undefined ? { imgAlt: item.imgAlt } : {}),
        ...(Array.isArray(item?.imgAltStates) && item.imgAltStates.length
            ? {
                imgAltStates: item.imgAltStates.map((state) => ({
                    tag: state.tag || '',
                    imgAltMissing: state.imgAltMissing === true,
                    ...(state.imgAlt !== undefined ? { imgAlt: state.imgAlt } : {}),
                })),
            }
            : {}),
    };
}

function normalizeDuplicateKey(value) {
    const text = String(value ?? '').trim();
    return text ? text.toLowerCase() : '';
}

function getH1Texts(data) {
    return (data.headings || [])
        .filter((heading) => heading.level === 1)
        .map((heading) => String(heading.text ?? '').trim())
        .filter(Boolean);
}

function getPrimaryH1Text(data) {
    return getH1Texts(data)[0] || '';
}

function h1CellHtml(data, dupCounts) {
    const h1Texts = getH1Texts(data);
    if (!h1Texts.length) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const primary = h1Texts[0];
    const h1Dup = getTextDuplicateCount(primary, dupCounts.h1);
    const fullTitle = escapeHtml(h1Texts.join('\n'));
    const extra = h1Texts.length > 1
        ? `<span class="text-zinc-400 ml-1" title="${fullTitle}">+${h1Texts.length - 1}</span>`
        : '';
    return `<span title="${fullTitle}">${escapeHtml(primary)}</span>${duplicateCountBadge(h1Dup)}${extra}`;
}

function normalizeSourceFilter(value) {
    if (value === 'external' || value === 'links-external' || value === 'has-external') {
        return 'external';
    }
    if (value === 'internal' || value === 'links-internal' || value === 'no-external') {
        return 'internal';
    }
    if (value === 'all' || value === 'pages' || value === 'links-all' || value === 'links') {
        return 'all';
    }
    return 'all';
}

function normalizeContentTypeFilter(value) {
    if (!value || value === 'all') {
        return 'all';
    }
    if (value === 'images') {
        return 'media';
    }
    if (value === 'unknown' || value === 'other') {
        return 'all';
    }
    return value;
}

function normalizeLegacyLink(link) {
    if (typeof link === 'string') {
        return {
            url: link,
            text: '',
            external: false,
            kind: '',
            tag: 'a[href]',
            fetched: false,
        };
    }
    if (!link) {
        return null;
    }
    const url = link.url || link.href;
    if (!url) {
        return null;
    }
    return {
        url,
        text: link.text || '',
        external: Boolean(link.external),
        kind: link.kind || '',
        tag: link.tag || '',
        rel: link.rel || '',
        relFollowAllowed: link.relFollowAllowed ?? null,
        relIndexAllowed: link.relIndexAllowed ?? null,
        relLabel: link.relLabel || '',
        status: '',
        title: '',
        fetched: false,
    };
}

function normalizeLinkEntryImpl(data, scanHostname = '') {
    const url = data.url || data.href;
    const hasStatus = data.status !== '' && data.status !== undefined && data.status !== null;
    const fetched = data.fetched ?? hasStatus;
    const external = typeof data.external === 'boolean'
        ? data.external
        : isExternalUrlImpl(url, scanHostname);
    const tag = data.tag || '';
    let kind = data.kind || '';
    if (isJavascriptResource({ ...data, url, tag, kind })) {
        kind = 'javascript';
    } else if (isCssResource({ ...data, url, tag, kind })) {
        kind = 'css';
    } else if (isMediaResource({ ...data, url, tag, kind })) {
        kind = 'media';
    } else if (!kind) {
        const inferred = inferLinkKind({ ...data, url, tag, kind: '' });
        if (inferred && inferred !== 'html') {
            kind = inferred === 'images' ? 'media' : inferred;
        }
    }
    const entry = {
        ...data,
        url,
        external,
        kind,
        tag,
        fetched,
    };
    return {
        ...entry,
        title: getPageTitle(entry),
    };
}

function isExternalLinkImpl(entry, scanHostname = '') {
    if (typeof entry.external === 'boolean') {
        return entry.external;
    }
    return isExternalUrlImpl(entry.url || entry.href || '', scanHostname);
}

function normalizeLinkKind(kind) {
    if (!kind || kind === 'unknown') {
        return 'other';
    }
    return kind;
}

function formatLinkKindLabel(kind) {
    if (!kind) {
        return '—';
    }
    return OUTLINK_KIND_LABELS[kind] || kind || OUTLINK_KIND_LABELS.unknown;
}

const formatOutlinkKindLabel = formatLinkKindLabel;

function getUrlPathnameLower(href) {
    try {
        return new URL(href).pathname.toLowerCase();
    } catch {
        return '';
    }
}

function looksLikeJavascriptUrl(href, ext, pathLower) {
    return ext === 'js' || ext === 'mjs' || ext === 'map'
        || pathLower.endsWith('.js')
        || pathLower.endsWith('/js')
        || pathLower.includes('.js/')
        || pathLower.includes('/js/');
}

function inferKindFromTag(tag) {
    const t = String(tag || '').toLowerCase();
    if (!t) {
        return null;
    }
    if (t === 'script[src]' || t.startsWith('script') || t.includes('modulepreload')) {
        return 'javascript';
    }
    if (t.includes('stylesheet') || t === 'link[rel=stylesheet]') {
        return 'css';
    }
    if (
        t === 'img[src]'
        || t === 'img[srcset]'
        || t === 'input[type=image][src]'
        || t === 'link[rel=icon]'
        || t.includes('apple-touch-icon')
    ) {
        return 'images';
    }
    if (
        t === 'video[src]'
        || t === 'audio[src]'
        || t.startsWith('video>')
        || t.startsWith('audio>')
        || t === 'source[src]'
        || t === 'source[srcset]'
    ) {
        return 'media';
    }
    if (t === 'a[href]' || t === 'area[href]' || t === 'iframe[src]' || t === 'form[action]') {
        return 'html';
    }
    if (t === 'embed[src]' || t === 'object[data]') {
        return 'plugins';
    }
    if (t.includes('preconnect') || t.includes('dns-prefetch')) {
        return 'other';
    }
    if (t.startsWith('link[rel=')) {
        if (t.includes('stylesheet')) {
            return 'css';
        }
        if (t.includes('icon') || t.includes('apple-touch-icon')) {
            return 'images';
        }
        if (t.includes('preload') || t.includes('prefetch')) {
            return null;
        }
        return 'other';
    }
    return null;
}

function inferLinkKindFromUrl(entry) {
    const href = entry.url || entry.href || '';
    const ext = getUrlExtension(href);
    const pathLower = getUrlPathnameLower(href);

    if (looksLikeJavascriptUrl(href, ext, pathLower)) {
        return 'javascript';
    }
    if (ext === 'css') {
        return 'css';
    }
    if (OUTLINK_FONT_EXTENSIONS.has(ext)) {
        return 'fonts';
    }
    if (OUTLINK_IMAGE_EXTENSIONS.has(ext)) {
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
    if (OUTLINK_HTML_EXTENSIONS.has(ext)) {
        return 'html';
    }
    if (!ext) {
        return 'other';
    }
    return 'other';
}

function inferLinkKind(entry) {
    const rawKind = String(entry?.kind || '').toLowerCase();
    if (rawKind && OUTLINK_KIND_LABELS[rawKind]) {
        return normalizeLinkKind(rawKind);
    }

    const fromTag = inferKindFromTag(entry?.tag);
    if (fromTag) {
        return fromTag;
    }

    const text = String(entry.text || entry.title || '').toLowerCase();
    if (text === 'script') {
        return 'javascript';
    }
    if (text.includes('stylesheet')) {
        return 'css';
    }
    if (text === 'image' || text === 'input') {
        return 'images';
    }
    if (text === 'video' || text === 'audio' || text === 'media') {
        return 'media';
    }
    if (text === 'iframe' || text === 'form' || text === 'area') {
        return 'html';
    }
    if (text.includes('preconnect') || text.includes('dns-prefetch')) {
        return 'other';
    }

    return inferLinkKindFromUrl(entry);
}

function inferLinkTag(entry) {
    if (entry.tag) {
        return entry.tag;
    }
    const text = String(entry.text || entry.title || '').toLowerCase();
    if (text === 'script') return 'script[src]';
    if (text === 'iframe') return 'iframe[src]';
    if (text === 'embed') return 'embed[src]';
    if (text === 'object') return 'object[data]';
    if (text === 'form') return 'form[action]';
    if (text === 'video') return 'video[src]';
    if (text === 'audio') return 'audio[src]';
    if (text === 'image' || text === 'input') return 'img[src]';
    if (text === 'area') return 'area[href]';
    if (text === 'media') return 'source[src]';
    if (text.startsWith('link') || text.includes('preload') || text.includes('preconnect') || text.includes('dns-prefetch')) {
        const rel = text.replace(/^link\s*/i, '').trim();
        if (rel) {
            return `link[rel=${rel.split(/\s+/)[0]}]`;
        }
        return 'link[href]';
    }
    return 'a[href]';
}

function getLinkTag(entry) {
    return inferLinkTag(entry);
}

const getOutlinkTag = getLinkTag;

function isRelApplicableLink(entry) {
    const tag = getLinkTag(entry);
    return tag === 'a[href]' || tag === 'area[href]';
}

function parseLinkRel(rel) {
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

function getLinkRelInfo(link) {
    if (!isRelApplicableLink(link)) {
        return {
            rel: '',
            relFollowAllowed: null,
            relIndexAllowed: null,
            relLabel: '',
            applicable: false,
        };
    }
    if (
        link.rel !== undefined
        || link.relFollowAllowed !== undefined
        || link.relIndexAllowed !== undefined
        || link.relLabel !== undefined
    ) {
        const parsed = parseLinkRel(link.rel || '');
        return {
            rel: link.rel || '',
            relFollowAllowed: link.relFollowAllowed ?? parsed.relFollowAllowed,
            relIndexAllowed: link.relIndexAllowed ?? parsed.relIndexAllowed,
            relLabel: link.relLabel || parsed.relLabel,
            applicable: true,
        };
    }
    return { ...parseLinkRel(''), applicable: true };
}

function formatRelAllowedStatus(allowed, { naText = '—' } = {}) {
    if (allowed === null || allowed === undefined) {
        return `<span class="text-zinc-400 italic">${naText}</span>`;
    }
    if (allowed) {
        return '<span class="text-green-700 font-medium">Дозволено</span>';
    }
    return '<span class="text-amber-700 font-medium">Обмежено</span>';
}

function buildFieldDuplicateCounts(getValue, entries = []) {
    const counts = new Map();
    for (const data of entries) {
        const key = normalizeDuplicateKey(getValue(data));
        if (!key) {
            continue;
        }
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function buildH1DuplicateCounts(entries = []) {
    const counts = new Map();
    for (const data of entries) {
        const seen = new Set();
        for (const text of getH1Texts(data)) {
            const key = normalizeDuplicateKey(text);
            if (!key || seen.has(key)) {
                continue;
            }
            seen.add(key);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    return counts;
}

function getTextDuplicateCount(value, counts) {
    const key = normalizeDuplicateKey(value);
    if (!key) {
        return 0;
    }
    return counts.get(key) || 0;
}

function hasDuplicateH1(data, h1Counts) {
    return getH1Texts(data).some((text) => getTextDuplicateCount(text, h1Counts) > 1);
}

function hasDuplicateField(value, counts) {
    return getTextDuplicateCount(value, counts) > 1;
}

function duplicateCountBadge(count) {
    if (!count || count <= 1) {
        return '';
    }
    return `<span class="text-amber-600 font-semibold ml-1" title="Таких самих на ${count} сторінках">×${count}</span>`;
}

function titleCellBadge(data, dupCounts) {
    const pageTitle = getPageTitle(data);
    if (!pageTitle) {
        return '';
    }
    return duplicateCountBadge(getTextDuplicateCount(pageTitle, dupCounts.title));
}

function isExternalOutlink(entry) {
    return isExternalLinkImpl(entry);
}

function getRowSearchTextImpl(data, getReferrersForUrl = () => []) {
    const headingText = (data.headings || []).map((heading) => heading.text).join(' ');
    const referrerText = getReferrersForUrl(data.url).map((ref) => `${ref.href} ${ref.text}`).join(' ');
    return [
        data.url,
        data.status,
        data.contentType,
        data.title,
        data.text,
        data.metaDescription,
        data.metaCanonical,
        data.kind,
        data.tag,
        data.rel,
        data.relLabel,
        data.metaRobots,
        data.metaRobotsLabel,
        data.xRobotsTag,
        data.xRobotsTagLabel,
        data.robotsRule,
        ...(Array.isArray(data.responseHeaders)
            ? data.responseHeaders.flatMap((header) => [header.name, header.value])
            : []),
        headingText,
        referrerText,
        formatLinkKindLabel(getResourceKind(data)),
    ].filter(Boolean).join(' ').toLowerCase();
}

function matchesSearchFilterImpl(data, searchQuery = '', getReferrersForUrl = () => []) {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
        return true;
    }
    return getRowSearchTextImpl(data, getReferrersForUrl).includes(query);
}

function isImgOutlinkTag(tag) {
    const normalized = String(tag || '');
    return normalized === 'img[src]' || normalized === 'img[srcset]';
}

function isImgAltEdge(entry) {
    if (!entry) {
        return false;
    }
    if (isImgOutlinkTag(entry.tag)) {
        return true;
    }
    if (entry.imgAltMissing === true) {
        return true;
    }
    return entry.imgAlt !== undefined;
}

function isLegacyMissingAltEdge(edge) {
    return isImgOutlinkTag(edge?.tag)
        && String(edge?.text || '').trim() === 'image'
        && edge?.imgAlt === undefined
        && edge?.imgAltMissing !== false;
}

function isLegacyMissingAltImageRow(data) {
    return isImgOutlinkTag(data?.tag)
        && String(data?.text || '').trim() === 'image'
        && data?.imgAlt === undefined
        && data?.imgAltMissing !== false;
}

function expandReferrerImgAltSources(ref) {
    if (!ref) {
        return [];
    }
    if (Array.isArray(ref.imgAltStates) && ref.imgAltStates.length) {
        return ref.imgAltStates.map((state) => ({
            tag: state.tag || ref.tag,
            text: ref.text,
            imgAltMissing: state.imgAltMissing === true,
            ...(state.imgAlt !== undefined ? { imgAlt: state.imgAlt } : {}),
        })).filter(isImgAltEdge);
    }
    return isImgAltEdge(ref) ? [ref] : [];
}

function getImageAltSources(data, getReferrersForUrl = () => []) {
    const sources = [];
    for (const ref of getReferrersForUrl(data.url)) {
        sources.push(...expandReferrerImgAltSources(ref));
    }

    if (isImgAltEdge(data) || isLegacyMissingAltImageRow(data)) {
        sources.push({
            tag: data.tag,
            text: data.text,
            imgAlt: data.imgAlt,
            imgAltMissing: data.imgAltMissing === true || isLegacyMissingAltImageRow(data),
        });
    }

    return sources;
}

const TABLE_VIEW_PAGE_META_COLUMN_IDS = new Set([
    'h1',
    'title',
    'metaDescription',
    'metaRobots',
    'ogTitle',
    'ogImage',
]);

const TABLE_VIEW_IMAGE_HIDDEN_COLUMN_IDS = new Set([
    'contentType',
    ...TABLE_VIEW_PAGE_META_COLUMN_IDS,
]);

function getTableViewProfile(contentFilter = 'all') {
    if (contentFilter === 'media') {
        return 'images';
    }
    if (contentFilter === 'javascript' || contentFilter === 'css') {
        return 'asset';
    }
    return 'full';
}

function insertTableColumnAfter(columns, afterId, column) {
    const index = columns.findIndex((col) => col.id === afterId);
    if (index === -1) {
        return [...columns, column];
    }
    return [
        ...columns.slice(0, index + 1),
        column,
        ...columns.slice(index + 1),
    ];
}

function collectImageAltParts(data, getReferrersForUrl = () => []) {
    const sources = getImageAltSources(data, getReferrersForUrl);
    if (!sources.length) {
        return { missing: false, values: [] };
    }

    const values = [];
    const seen = new Set();
    let missing = false;

    for (const ref of sources) {
        if (ref.imgAltMissing || isLegacyMissingAltEdge(ref)) {
            missing = true;
            continue;
        }
        const alt = ref.imgAlt !== undefined
            ? ref.imgAlt
            : (ref.text && ref.text !== 'image' ? ref.text : '');
        const key = alt;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        values.push(alt);
    }

    return { missing, values };
}

const ALT_SORT_TIER = {
    MISSING_ONLY: 0,
    MISSING_MIX: 1,
    EMPTY_ONLY: 2,
    EMPTY_MIX: 3,
    TEXT_ONLY: 4,
    NONE: 5,
};

function classifyImageAltSortTier(missing, values) {
    const hasEmpty = values.some((value) => value === '');
    const hasText = values.some((value) => value !== '');

    if (missing && values.length === 0) {
        return ALT_SORT_TIER.MISSING_ONLY;
    }
    if (missing) {
        return ALT_SORT_TIER.MISSING_MIX;
    }
    if (values.length === 0) {
        return ALT_SORT_TIER.MISSING_ONLY;
    }
    if (hasEmpty && !hasText) {
        return ALT_SORT_TIER.EMPTY_ONLY;
    }
    if (hasEmpty) {
        return ALT_SORT_TIER.EMPTY_MIX;
    }
    return ALT_SORT_TIER.TEXT_ONLY;
}

function getImageAltSortParts(data, getReferrersForUrl = () => []) {
    const sources = getImageAltSources(data, getReferrersForUrl);
    if (!sources.length) {
        return { tier: ALT_SORT_TIER.MISSING_ONLY, text: '' };
    }

    const { missing, values } = collectImageAltParts(data, getReferrersForUrl);
    const tier = classifyImageAltSortTier(missing, values);
    if (tier !== ALT_SORT_TIER.TEXT_ONLY) {
        return { tier, text: '' };
    }
    const primary = [...values].sort((a, b) => a.localeCompare(b, 'uk'))[0];
    return {
        tier,
        text: primary.toLocaleLowerCase('uk'),
    };
}

function compareImageAltSortImpl(a, b, getReferrersForUrl = () => [], direction = 'asc') {
    const mul = direction === 'asc' ? 1 : -1;
    const pa = getImageAltSortParts(a, getReferrersForUrl);
    const pb = getImageAltSortParts(b, getReferrersForUrl);
    if (pa.tier !== pb.tier) {
        return (pa.tier - pb.tier) * mul;
    }
    if (pa.tier === ALT_SORT_TIER.TEXT_ONLY && pa.text !== pb.text) {
        return pa.text.localeCompare(pb.text, 'uk') * mul;
    }
    return a.url.localeCompare(b.url, 'uk') * mul;
}

function imageAltCellHtml(data, getReferrersForUrl = () => []) {
    const { missing, values } = collectImageAltParts(data, getReferrersForUrl);
    if (!missing && values.length === 0) {
        return '<span class="text-zinc-400 italic">—</span>';
    }

    const parts = [];
    if (missing) {
        parts.push('<span class="text-amber-700 font-medium" title="Немає атрибута alt">немає</span>');
    }
    for (const value of values) {
        if (value === '') {
            parts.push('<span class="text-zinc-500 italic" title="alt=&quot;&quot;">(порожній)</span>');
        } else {
            parts.push(`<span class="text-zinc-800">${escapeHtml(value)}</span>`);
        }
    }
    return parts.join('<br>');
}

function imageAltSortValue(data, getReferrersForUrl = () => []) {
    const { tier, text } = getImageAltSortParts(data, getReferrersForUrl);
    if (tier === ALT_SORT_TIER.TEXT_ONLY) {
        return `4:${text}`;
    }
    return String(tier);
}

function buildAltTableColumn(getReferrersForUrl) {
    return {
        id: 'alt',
        sortKey: 'alt',
        minWidth: 120,
        thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
        thLabel: 'alt',
        renderCell: (data) => `<td class="p-2">${imageAltCellHtml(data, getReferrersForUrl)}</td>`,
    };
}

function applyTableViewProfile(columns, profile, helpers = {}) {
    if (profile === 'full') {
        return columns;
    }

    const getReferrersForUrl = helpers.getReferrersForUrl || (() => []);

    if (profile === 'images') {
        const filtered = columns.filter((col) => !TABLE_VIEW_IMAGE_HIDDEN_COLUMN_IDS.has(col.id));
        if (filtered.some((col) => col.id === 'alt')) {
            return filtered;
        }
        return insertTableColumnAfter(filtered, 'status', buildAltTableColumn(getReferrersForUrl));
    }

    if (profile === 'asset') {
        return columns.filter((col) => !TABLE_VIEW_PAGE_META_COLUMN_IDS.has(col.id));
    }

    return columns;
}

function passesTableFiltersImpl(data, ctx) {
    const {
        activeSearchQuery = '',
        activeSourceFilter = 'all',
        activeStatusFilter = 'all',
        activeIndexingFilter = 'all',
        activeH1Filter = 'all',
        activeDuplicateFilter = 'all',
        activeContentFilter = 'all',
        scanHostname = '',
        getDuplicateCounts = () => ({ h1: new Map(), title: new Map(), description: new Map() }),
        getReferrersForUrl = () => [],
    } = ctx || {};
    if (!matchesSearchFilterImpl(data, activeSearchQuery, getReferrersForUrl)) {
        return false;
    }
    if (!passesSourceFilterForRowImpl(data, activeSourceFilter, scanHostname)) {
        return false;
    }
    if (!matchesStatusFilter(data.status, activeStatusFilter)) {
        return false;
    }
    if (activeIndexingFilter === 'allowed' && !isIndexingAllowed(data)) {
        return false;
    }
    if (activeIndexingFilter === 'blocked' && !isIndexingBlocked(data)) {
        return false;
    }
    if (activeH1Filter === 'multiple' && getH1Count(data) <= 1) {
        return false;
    }
    if (activeDuplicateFilter !== 'all') {
        const counts = getDuplicateCounts();
        if (activeDuplicateFilter === 'h1' && !hasDuplicateH1(data, counts.h1)) {
            return false;
        }
        if (activeDuplicateFilter === 'title' && !hasDuplicateField(getPageTitle(data), counts.title)) {
            return false;
        }
        if (activeDuplicateFilter === 'description' && !hasDuplicateField(data.metaDescription, counts.description)) {
            return false;
        }
    }
    return true;
}

function truncate(str, len = 80) {
    const s = String(str ?? '');
    return s.length > len ? `${s.slice(0, len)}…` : s;
}

function formatMultiValueDetail(value) {
    if (!value) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const parts = String(value).split(/\s*;\s*/).map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) {
        return escapeHtml(String(value).trim());
    }
    return parts.map((part) => escapeHtml(part)).join('<br>');
}

function formatCsvUrlListPreview(items, limit = 10) {
    const list = (Array.isArray(items) ? items : [])
        .map((item) => {
            if (typeof item === 'string') {
                return item.trim();
            }
            return String(item?.href || '').trim();
        })
        .filter(Boolean);
    const total = list.length;
    if (total === 0) {
        return '';
    }
    const preview = list.slice(0, limit).join('; ');
    if (total <= limit) {
        return preview;
    }
    return `${preview} (${total})`;
}

function formatRobotsTxtDetail(data) {
    if (data.robotsAllowed === null && !data.robotsRule) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const allowed = data.robotsAllowed !== false;
    const rule = data.robotsRule || (allowed ? 'Дозволено' : 'Заборонено');
    const cls = indexingStateClass('robots', null, data.robotsAllowed);
    return `<span class="${cls} font-medium">${escapeHtml(rule)}</span>`;
}

function formatMetaRobotsDetail(data) {
    const status = data.metaRobotsStatus || 'none';
    if (status === 'none' && !data.metaRobots && !data.metaRobotsLabel) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const label = data.metaRobotsLabel || data.metaRobots || 'index, follow';
    const cls = indexingStateClass('meta', status);
    return `<span class="${cls} font-medium">${formatMultiValueDetail(label)}</span>`;
}

function formatXRobotsTagDetail(data) {
    const status = data.xRobotsTagStatus || 'none';
    if (status === 'none' && !data.xRobotsTag && !data.xRobotsTagLabel) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const label = data.xRobotsTagLabel || data.xRobotsTag || '';
    const cls = indexingStateClass('meta', status);
    return `<span class="${cls} font-medium">${formatMultiValueDetail(label)}</span>`;
}

function formatResponseHeadersDetail(data) {
    const headers = data.responseHeaders;
    if (!Array.isArray(headers) || headers.length === 0) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const lines = headers.map(({ name, value }) => (
        `<div class="font-mono text-[11px] leading-relaxed">`
        + `<span class="text-zinc-500">${escapeHtml(name)}:</span> ${escapeHtml(value)}`
        + '</div>'
    ));
    return `<div class="space-y-0.5">${lines.join('')}</div>`;
}

function decodeUrlAttr(encoded) {
    try {
        return decodeURIComponent(encoded);
    } catch {
        return encoded;
    }
}

function getRowMetricsImpl(data, helpers = {}) {
    const getReferrersForUrl = helpers.getReferrersForUrl || (() => []);
    const getOutgoingLinksFrom = helpers.getOutgoingLinksFrom || (() => []);
    const isDiscoveredOnlyFn = helpers.isDiscoveredOnly || isDiscoveredOnly;
    const isExternalLinkFn = helpers.isExternalLink || ((entry) => isExternalLinkImpl(entry, helpers.scanHostname || ''));
    const scanHostname = helpers.scanHostname || '';
    const outgoing = isDiscoveredOnlyFn(data) ? [] : getOutgoingLinksFrom(data.url);
    return {
        inCount: getReferrersForUrl(data.url).length,
        linkCount: outgoing.length,
        internalCount: outgoing.filter((link) => !isExternalLinkFn(link, scanHostname)).length,
        externalCount: outgoing.filter((link) => isExternalLinkFn(link, scanHostname)).length,
    };
}

function resolveInsertionIndex(url, insertionOrder, helpers = {}) {
    if (typeof helpers.getInsertionIndex === 'function') {
        return helpers.getInsertionIndex(url);
    }
    return insertionOrder.indexOf(url);
}

function compareRowsImpl(a, b, sortState = { column: null, direction: 'asc' }, insertionOrder = [], helpers = {}) {
    const { column, direction } = sortState;
    const mul = direction === 'asc' ? 1 : -1;

    if (column === 'alt') {
        return compareImageAltSortImpl(
            a,
            b,
            helpers.getReferrersForUrl || (() => []),
            direction,
        );
    }

    const getMetrics = helpers.getRowMetrics
        ? helpers.getRowMetrics
        : (data) => getRowMetricsImpl(data, helpers);
    const ma = getMetrics(a);
    const mb = getMetrics(b);

    let va;
    let vb;
    switch (column) {
        case 'index':
            va = resolveInsertionIndex(a.url, insertionOrder, helpers);
            vb = resolveInsertionIndex(b.url, insertionOrder, helpers);
            break;
        case 'url':
            va = a.url;
            vb = b.url;
            break;
        case 'status':
            va = statusSortValue(a.status);
            vb = statusSortValue(b.status);
            break;
        case 'contentType':
            va = (a.contentType || '').toLowerCase();
            vb = (b.contentType || '').toLowerCase();
            break;
        case 'responseTimeMs':
        case 'responseTime':
            va = a.responseTimeMs ?? -1;
            vb = b.responseTimeMs ?? -1;
            break;
        case 'metaRobots':
            va = metaRobotsSortValue(a);
            vb = metaRobotsSortValue(b);
            break;
        case 'xRobotsTag':
            va = xRobotsTagSortValue(a);
            vb = xRobotsTagSortValue(b);
            break;
        case 'robotsTxt':
            va = robotsTxtSortValue(a);
            vb = robotsTxtSortValue(b);
            break;
        case 'title':
            va = getPageTitle(a).toLowerCase();
            vb = getPageTitle(b).toLowerCase();
            break;
        case 'h1':
            va = getPrimaryH1Text(a).toLowerCase();
            vb = getPrimaryH1Text(b).toLowerCase();
            break;
        case 'metaDescription':
            va = (a.metaDescription || '').toLowerCase();
            vb = (b.metaDescription || '').toLowerCase();
            break;
        case 'linkCount':
        case 'links':
            va = ma.linkCount;
            vb = mb.linkCount;
            break;
        case 'inCount':
        case 'inlinks':
            va = ma.inCount;
            vb = mb.inCount;
            break;
        case 'internalCount':
        case 'internalLinks':
            va = ma.internalCount;
            vb = mb.internalCount;
            break;
        case 'externalCount':
        case 'externalLinks':
            va = ma.externalCount;
            vb = mb.externalCount;
            break;
        case 'ogTitle':
            va = (a.ogTitle || '').toLowerCase();
            vb = (b.ogTitle || '').toLowerCase();
            break;
        case 'ogImage':
            va = (a.ogImage || '').toLowerCase();
            vb = (b.ogImage || '').toLowerCase();
            break;
        case 'redirectHopCount':
            va = redirectHopCountSortValue(a);
            vb = redirectHopCountSortValue(b);
            break;
        default:
            va = resolveInsertionIndex(a.url, insertionOrder, helpers);
            vb = resolveInsertionIndex(b.url, insertionOrder, helpers);
    }

    if (va < vb) return -1 * mul;
    if (va > vb) return 1 * mul;
    return a.url.localeCompare(b.url) * mul;
}

function compareLinkRowsImpl(a, b, linkTableSortState = { column: 'url', direction: 'asc' }) {
    const { column, direction } = linkTableSortState;
    const mul = direction === 'asc' ? 1 : -1;
    let va;
    let vb;
    switch (column) {
        case 'tag':
            va = getOutlinkTag(a).toLowerCase();
            vb = getOutlinkTag(b).toLowerCase();
            break;
        case 'rel': {
            const ra = getLinkRelInfo(a);
            const rb = getLinkRelInfo(b);
            va = (ra.rel || ra.relLabel || '').toLowerCase();
            vb = (rb.rel || rb.relLabel || '').toLowerCase();
            break;
        }
        case 'follow': {
            const fa = getLinkRelInfo(a).relFollowAllowed;
            const fb = getLinkRelInfo(b).relFollowAllowed;
            va = fa === null ? 2 : (fa ? 1 : 0);
            vb = fb === null ? 2 : (fb ? 1 : 0);
            break;
        }
        case 'text':
            va = (a.text || '').toLowerCase();
            vb = (b.text || '').toLowerCase();
            break;
        case 'url':
        default:
            va = (a.url || a.href || '').toLowerCase();
            vb = (b.url || b.href || '').toLowerCase();
            break;
    }
    if (va < vb) return -1 * mul;
    if (va > vb) return 1 * mul;
    return (a.url || a.href || '').localeCompare(b.url || b.href || '') * mul;
}

function linkTableSortIndicator(column, label, sortState = { column: null, direction: 'asc' }) {
    if (sortState.column !== column) {
        return label;
    }
    return `${label} ${sortState.direction === 'asc' ? '▲' : '▼'}`;
}
const exported = {
    escapeHtml,
    statusRowClass,
    indexingStateClass,
    metaRobotsCellHtml,
    xRobotsTagCellHtml,
    formatResponseTimeMs,
    robotsTxtCellHtml,
    statusSortValue,
    getUrlExtension,
    isHtmlContentType,
    mapKindToFilterKind,
    isJavascriptResource,
    isCssResource,
    isMediaResource,
    getCrawledResourceKind,
    isDiscoveredOnly,
    shouldHavePageTitle,
    getPageTitle,
    getResourceKind,
    getResourceType,
    isExternalUrlImpl,
    normalizeReferrerEntry,
    normalizeDuplicateKey,
    getH1Texts,
    getPrimaryH1Text,
    h1CellHtml,
    normalizeSourceFilter,
    normalizeContentTypeFilter,
    normalizeLegacyLink,
    normalizeLinkKind,
    formatLinkKindLabel,
    getUrlPathnameLower,
    looksLikeJavascriptUrl,
    inferKindFromTag,
    inferLinkKindFromUrl,
    inferLinkKind,
    inferLinkTag,
    getLinkTag,
    getOutlinkTag,
    isRelApplicableLink,
    parseLinkRel,
    getLinkRelInfo,
    formatRelAllowedStatus,
    buildFieldDuplicateCounts,
    buildH1DuplicateCounts,
    getTextDuplicateCount,
    hasDuplicateH1,
    hasDuplicateField,
    duplicateCountBadge,
    titleCellBadge,
    truncate,
    formatMultiValueDetail,
    formatCsvUrlListPreview,
    formatRobotsTxtDetail,
    formatMetaRobotsDetail,
    formatXRobotsTagDetail,
    formatResponseHeadersDetail,
    decodeUrlAttr,
    matchesStatusFilter,
    isMetaRobotsBlocked,
    isXRobotsTagBlocked,
    isImgOutlinkTag,
    getTableViewProfile,
    applyTableViewProfile,
    imageAltCellHtml,
    imageAltSortValue,
    compareImageAltSortImpl,
    isRobotsTxtBlocked,
    isIndexingBlocked,
    isIndexingAllowed,
    getH1Count,
    getRowSearchTextImpl,
    matchesSearchFilterImpl,
    passesTableFiltersImpl,
    compareRowsImpl,
    compareLinkRowsImpl,
    linkTableSortIndicator,
    normalizeLinkEntryImpl,
    isExternalLinkImpl,
    buildOutgoingLink,
    getRowMetricsImpl,
    matchesResourceTypeFilterImpl,
    isExternalOutlink,
    OUTLINK_KIND_LABELS,
    OUTLINK_IMAGE_EXTENSIONS,
    OUTLINK_MEDIA_EXTENSIONS,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
