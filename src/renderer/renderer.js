const urlInput = document.getElementById('urlInput');
const urlInputWrap = document.getElementById('urlInputWrap');
const urlInputProgress = document.getElementById('urlInputProgress');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const resumeButton = document.getElementById('resumeButton');
const restartButton = document.getElementById('restartButton');
const exportButton = document.getElementById('exportButton');
const controlsIdle = document.getElementById('controlsIdle');
const controlsRunning = document.getElementById('controlsRunning');
const controlsPaused = document.getElementById('controlsPaused');
const resultsTable = document.getElementById('resultsTable');
const pagesTableHead = document.getElementById('pagesTableHead');
const linksTableHead = document.getElementById('linksTableHead');
const detailContent = document.getElementById('detailContent');
const selectedUrlHint = document.getElementById('selectedUrlHint');
const selectedUrlBar = document.getElementById('selectedUrlBar');
const statusText = document.getElementById('status-text');
const statusScanned = document.getElementById('status-scanned');
const statusQueue = document.getElementById('status-queue');
const statusActive = document.getElementById('status-active');
const statusRate = document.getElementById('status-rate');
const contentTypeFilter = document.getElementById('contentTypeFilter');
const statusFilter = document.getElementById('statusFilter');
const indexingFilter = document.getElementById('indexingFilter');
const h1Filter = document.getElementById('h1Filter');
const duplicateFilter = document.getElementById('duplicateFilter');
const externalLinksFilter = document.getElementById('externalLinksFilter');
const filterCount = document.getElementById('filterCount');

const scanResults = new Map();
const insertionOrder = [];
let selectedUrl = null;
let selectedLinkUrl = null;
let activeTab = 'details';
let sortState = { column: null, direction: 'asc' };
/** @type {'all' | 'html' | 'media'} */
let activeContentFilter = 'all';
/** @type {string} */
let activeStatusFilter = 'all';
/** @type {'all' | 'allowed' | 'blocked'} */
let activeIndexingFilter = 'all';
/** @type {'all' | 'multiple'} */
let activeH1Filter = 'all';
/** @type {'all' | 'h1' | 'title' | 'description'} */
let activeDuplicateFilter = 'all';
/** @type {'pages' | 'links-all' | 'links-internal' | 'links-external'} */
let activeViewMode = 'pages';
let scanHostname = '';

const OUTLINK_KIND_PRIORITY = [
    'javascript', 'css', 'html', 'images', 'media', 'fonts', 'xml', 'pdf', 'plugins', 'other', 'unknown',
];

const OUTLINK_KIND_LABELS = {
    html: 'HTML',
    javascript: 'JavaScript',
    css: 'CSS',
    images: 'Images',
    media: 'Media',
    fonts: 'Fonts',
    xml: 'XML',
    pdf: 'PDF',
    plugins: 'Plugins',
    other: 'Other',
    unknown: 'Unknown',
};

const ALL_CONTENT_TYPE_OPTIONS = [
    { value: 'all', label: 'Усі' },
    ...Object.entries(OUTLINK_KIND_LABELS).map(([value, label]) => ({ value, label })),
];

const OUTLINK_IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff',
]);
const OUTLINK_MEDIA_EXTENSIONS = new Set([
    'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv', 'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a',
]);
const OUTLINK_FONT_EXTENSIONS = new Set(['woff', 'woff2', 'ttf', 'eot', 'otf']);
const OUTLINK_PLUGIN_EXTENSIONS = new Set(['swf', 'flv']);
const OUTLINK_HTML_EXTENSIONS = new Set(['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'shtml']);
let duplicateCountsCache = null;
let linksIndexCache = null;
let knownPresentContentTypesKey = '';
let latestReferrersByUrl = new Map();
/** @type {'idle' | 'running' | 'paused'} */
let uiState = 'idle';
let knownStatusCodes = new Set();
let refreshTableTimer = null;
const REFRESH_TABLE_DELAY_MS = 120;
let lastScanProgress = null;
let workspacePersistTimer = null;
const WORKSPACE_PERSIST_DELAY_MS = 200;

const MEDIA_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff',
    'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv',
    'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a',
    'pdf', 'zip', 'gz', 'rar', '7z', 'tar',
    'css', 'js', 'mjs', 'map',
    'woff', 'woff2', 'ttf', 'eot', 'otf',
    'xml', 'json', 'txt', 'csv',
]);

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function statusRowClass(status) {
    if (status === 200) return 'text-green-700';
    if (status === 'SKIPPED') return 'text-yellow-700';
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
    return `<span class="${cls} font-medium" title="${escapeHtml(title)}: ${escapeHtml(label)}">${escapeHtml(truncate(label, 28))}</span>`;
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
    return `<span class="${cls} font-medium" title="${escapeHtml(title)}">${escapeHtml(truncate(rule, 32))}</span>`;
}

function statusSortValue(status) {
    if (typeof status === 'number') return status;
    if (status === 'ERROR') return 10000;
    if (status === 'SKIPPED') return 9999;
    return 5000;
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

function getResourceType(data) {
    const contentType = (data.contentType || '').toLowerCase();

    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        return 'html';
    }
    if (
        contentType.startsWith('image/')
        || contentType.startsWith('video/')
        || contentType.startsWith('audio/')
        || contentType.includes('font')
        || contentType === 'text/css'
        || contentType.includes('javascript')
        || contentType === 'application/pdf'
        || contentType === 'application/json'
        || contentType.includes('xml')
    ) {
        return 'media';
    }

    const extension = getUrlExtension(data.url);
    if (MEDIA_EXTENSIONS.has(extension)) {
        return 'media';
    }

    if (typeof data.status === 'number' && data.status >= 300 && data.status < 400) {
        return 'html';
    }

    if (data.outlinks?.length || data.headings?.length || data.metaDescription) {
        return 'html';
    }

    return 'html';
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

function isRobotsTxtBlocked(data) {
    return data.robotsAllowed === false || data.status === 'SKIPPED';
}

function isIndexingBlocked(data) {
    return isMetaRobotsBlocked(data) || isRobotsTxtBlocked(data);
}

function isIndexingAllowed(data) {
    if (isIndexingBlocked(data)) {
        return false;
    }
    if (data.robotsAllowed !== true) {
        return false;
    }
    const metaStatus = data.metaRobotsStatus || 'none';
    return metaStatus === 'allowed';
}

function getH1Count(data) {
    return (data.headings || []).filter((heading) => heading.level === 1).length;
}

function normalizeReferrerEntry(item) {
    if (typeof item === 'string') {
        return { href: item, text: '' };
    }
    return {
        href: String(item?.href || '').trim(),
        text: String(item?.text || '').trim(),
    };
}

function getReferrersForUrl(url) {
    let raw = [];
    if (latestReferrersByUrl.has(url)) {
        raw = latestReferrersByUrl.get(url);
    } else {
        const data = scanResults.get(url);
        if (data?.referrers?.length) {
            raw = data.referrers;
        }
    }
    return raw.map(normalizeReferrerEntry).filter((entry) => entry.href);
}

function rebuildLatestReferrersFromResults() {
    latestReferrersByUrl = new Map();
    for (const [url, data] of scanResults.entries()) {
        if (data.referrers?.length) {
            latestReferrersByUrl.set(url, data.referrers);
        }
    }
}

function applyReferrersUpdate(allReferrers) {
    latestReferrersByUrl = new Map();
    for (const [url, refs] of Object.entries(allReferrers || {})) {
        const normalized = Array.isArray(refs)
            ? refs.map(normalizeReferrerEntry).filter((entry) => entry.href)
            : [];
        latestReferrersByUrl.set(url, normalized);
    }

    for (const [url, data] of scanResults.entries()) {
        if (latestReferrersByUrl.has(url)) {
            data.referrers = latestReferrersByUrl.get(url);
        }
    }

    requestRefreshTable({ immediate: true });
    scheduleWorkspacePersist();
    if (selectedUrl) {
        renderDetailPanel();
    }
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
    return `<span title="${fullTitle}">${escapeHtml(truncate(primary, 50))}</span>${duplicateCountBadge(h1Dup)}${extra}`;
}

function invalidateDuplicateCounts() {
    duplicateCountsCache = null;
}

function invalidateLinksIndex() {
    linksIndexCache = null;
    knownPresentContentTypesKey = '';
}

function isPagesListView() {
    return activeViewMode === 'pages';
}

function isLinksListView() {
    return !isPagesListView();
}

function normalizeViewMode(value) {
    if (value === 'pages') {
        return 'pages';
    }
    if (value === 'external' || value === 'links-external' || value === 'has-external') {
        return 'links-external';
    }
    if (value === 'links-internal' || value === 'internal' || value === 'no-external') {
        return 'links-internal';
    }
    if (value === 'links-all' || value === 'all' || value === 'links') {
        return 'links-all';
    }
    return 'pages';
}

function getLinkHost(href) {
    try {
        return new URL(href).hostname;
    } catch {
        return '';
    }
}

function formatOutlinkKindLabel(kind) {
    return OUTLINK_KIND_LABELS[kind] || kind || OUTLINK_KIND_LABELS.unknown;
}

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

function inferOutlinkKind(link) {
    if (link.kind && OUTLINK_KIND_LABELS[link.kind]) {
        return link.kind;
    }
    const href = link.href || '';
    const text = String(link.text || '').toLowerCase();
    const ext = getUrlExtension(href);
    const pathLower = getUrlPathnameLower(href);

    if (text === 'script') {
        return 'javascript';
    }
    if (text === 'iframe') {
        return 'html';
    }
    if (text === 'embed' || text === 'object') {
        return 'plugins';
    }
    if (text === 'video' || text === 'audio') {
        return 'media';
    }
    if (text === 'image' || text === 'input') {
        return 'images';
    }
    if (looksLikeJavascriptUrl(href, ext, pathLower)) {
        return 'javascript';
    }
    if (text.includes('stylesheet') || ext === 'css') {
        return 'css';
    }
    if (OUTLINK_FONT_EXTENSIONS.has(ext) || text.includes('font')) {
        return 'fonts';
    }
    if (OUTLINK_IMAGE_EXTENSIONS.has(ext)) {
        return 'images';
    }
    if (text === 'media' || OUTLINK_MEDIA_EXTENSIONS.has(ext)) {
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
    if (text.includes('preconnect') || text.includes('dns-prefetch')) {
        return 'other';
    }
    if (text === 'form' || text === 'area' || !ext || OUTLINK_HTML_EXTENSIONS.has(ext)) {
        return 'html';
    }
    if (text === 'link') {
        return 'other';
    }
    if (!ext) {
        return 'unknown';
    }
    return 'other';
}

function resolvePrimaryOutlinkKind(kinds) {
    for (const kind of OUTLINK_KIND_PRIORITY) {
        if (kinds.includes(kind)) {
            return kind;
        }
    }
    return kinds[0] || 'unknown';
}

function collectPresentContentTypes() {
    const present = new Set();
    if (isPagesListView()) {
        for (const page of scanResults.values()) {
            const resourceType = getResourceType(page);
            if (resourceType === 'html' || resourceType === 'media') {
                present.add(resourceType);
            }
            for (const link of page.outlinks || []) {
                present.add(getOutlinkKind(link));
            }
        }
        return present;
    }

    for (const entry of getLinksIndex()) {
        if (!passesLinkScopeFilter(entry)) {
            continue;
        }
        for (const kind of entry.kinds) {
            present.add(kind);
        }
    }
    return present;
}

function getContentTypeFilterOptions() {
    const present = collectPresentContentTypes();
    return ALL_CONTENT_TYPE_OPTIONS.filter((option) => option.value === 'all' || present.has(option.value));
}

function rebuildContentTypeFilterOptions({ preserveValue = true, force = false } = {}) {
    if (!contentTypeFilter) {
        return;
    }
    const present = collectPresentContentTypes();
    const presentKey = [...present].sort().join(',');
    if (!force && presentKey === knownPresentContentTypesKey && contentTypeFilter.options.length > 0) {
        return;
    }
    knownPresentContentTypesKey = presentKey;

    const options = getContentTypeFilterOptions();
    const previous = preserveValue ? activeContentFilter : 'all';
    contentTypeFilter.innerHTML = '';
    for (const option of options) {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        contentTypeFilter.appendChild(el);
    }
    const hasPrevious = options.some((option) => option.value === previous);
    activeContentFilter = hasPrevious ? previous : 'all';
    contentTypeFilter.value = activeContentFilter;
}

function pageMatchesContentTypeFilter(data, filter) {
    if (filter === 'html') {
        return getResourceType(data) === 'html'
            || (data.outlinks || []).some((link) => getOutlinkKind(link) === 'html');
    }
    if (filter === 'media') {
        return getResourceType(data) === 'media'
            || (data.outlinks || []).some((link) => getOutlinkKind(link) === 'media');
    }
    return (data.outlinks || []).some((link) => getOutlinkKind(link) === filter);
}

function getOutlinkKind(link) {
    return inferOutlinkKind(link);
}

function inferOutlinkTag(link) {
    if (link.tag) {
        return link.tag;
    }
    const text = String(link.text || '').toLowerCase();
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

function getOutlinkTag(link) {
    return inferOutlinkTag(link);
}

function isRelApplicableLink(link) {
    const tag = getOutlinkTag(link);
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
        const hasRel = Boolean(link.rel);
        return {
            rel: link.rel || '',
            relFollowAllowed: link.relFollowAllowed ?? true,
            relIndexAllowed: link.relIndexAllowed ?? true,
            relLabel: link.relLabel || (hasRel ? link.rel : 'follow'),
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

function summarizeEntryRelInfo(sources) {
    const relSources = sources
        .map((source) => getLinkRelInfo(source))
        .filter((info) => info.applicable);
    if (!relSources.length) {
        return {
            applicable: false,
            rel: '',
            relLabel: '',
            relFollowAllowed: null,
            relIndexAllowed: null,
            mixed: false,
        };
    }

    const relValues = [...new Set(relSources.map((info) => info.rel).filter(Boolean))];
    const relLabels = [...new Set(relSources.map((info) => info.relLabel).filter(Boolean))];
    const followValues = [...new Set(relSources.map((info) => info.relFollowAllowed))];
    const indexValues = [...new Set(relSources.map((info) => info.relIndexAllowed))];

    return {
        applicable: true,
        rel: relValues.length === 1 ? relValues[0] : relValues.join('; '),
        relLabel: relLabels.length === 1 ? relLabels[0] : relLabels.join('; '),
        relFollowAllowed: followValues.length === 1 ? followValues[0] : null,
        relIndexAllowed: indexValues.length === 1 ? indexValues[0] : null,
        mixed: relValues.length > 1 || followValues.length > 1 || indexValues.length > 1,
    };
}

function linkEntryHasKind(entry, kind) {
    if (entry.kinds?.includes(kind)) {
        return true;
    }
    return entry.sources.some((source) => source.kind === kind);
}

function passesLinkContentFilter(entry) {
    if (activeContentFilter === 'all') {
        return true;
    }
    return linkEntryHasKind(entry, activeContentFilter);
}

function passesLinkScopeFilter(entry) {
    if (activeViewMode === 'links-internal') {
        return !entry.external;
    }
    if (activeViewMode === 'links-external') {
        return entry.external;
    }
    return true;
}

function buildLinksIndex() {
    const map = new Map();
    for (const page of scanResults.values()) {
        for (const link of page.outlinks || []) {
            const href = link.href;
            if (!href) {
                continue;
            }
            if (!map.has(href)) {
                map.set(href, {
                    href,
                    host: getLinkHost(href),
                    external: isExternalOutlink(link),
                    sources: [],
                });
            }
            const relInfo = getLinkRelInfo(link);
            map.get(href).sources.push({
                pageUrl: page.url,
                text: link.text || '',
                kind: getOutlinkKind(link),
                tag: getOutlinkTag(link),
                rel: relInfo.rel,
                relFollowAllowed: relInfo.relFollowAllowed,
                relIndexAllowed: relInfo.relIndexAllowed,
                relLabel: relInfo.relLabel,
            });
        }
    }

    return [...map.values()].map((entry) => {
        const kinds = [...new Set(entry.sources.map((source) => source.kind))];
        const tags = [...new Set(entry.sources.map((source) => source.tag))];
        return {
            ...entry,
            kinds,
            tags,
            kind: resolvePrimaryOutlinkKind(kinds),
            tag: tags[0] || 'a[href]',
            sourceCount: entry.sources.length,
            sampleText: entry.sources.find((source) => source.text)?.text || '',
        };
    });
}

function getLinksIndex() {
    if (!linksIndexCache) {
        linksIndexCache = buildLinksIndex();
    }
    return linksIndexCache;
}

function getLinkEntry(href) {
    return getLinksIndex().find((entry) => entry.href === href) || null;
}

function getDisplayedLinks() {
    const entries = getLinksIndex()
        .filter(passesLinkScopeFilter)
        .filter(passesLinkContentFilter);
    const sorted = [...entries];
    if (sortState.column) {
        sorted.sort(compareLinkRows);
    } else {
        sorted.sort((a, b) => a.href.localeCompare(b.href));
    }
    return sorted;
}

function compareLinkRows(a, b) {
    const { column, direction } = sortState;
    const mul = direction === 'asc' ? 1 : -1;
    let va;
    let vb;

    switch (column) {
        case 'scope':
            va = a.external ? 'зовнішнє' : 'внутрішнє';
            vb = b.external ? 'зовнішнє' : 'внутрішнє';
            break;
        case 'host':
            va = a.host.toLowerCase();
            vb = b.host.toLowerCase();
            break;
        case 'pages':
            va = a.sourceCount;
            vb = b.sourceCount;
            break;
        case 'kind':
            va = formatOutlinkKindLabel(a.kind).toLowerCase();
            vb = formatOutlinkKindLabel(b.kind).toLowerCase();
            break;
        case 'tag':
            va = a.tag.toLowerCase();
            vb = b.tag.toLowerCase();
            break;
        case 'text':
            va = a.sampleText.toLowerCase();
            vb = b.sampleText.toLowerCase();
            break;
        case 'url':
        default:
            va = a.href;
            vb = b.href;
    }

    if (va < vb) return -1 * mul;
    if (va > vb) return 1 * mul;
    return a.href.localeCompare(b.href) * mul;
}

function updateTableHeadMode() {
    if (pagesTableHead) {
        pagesTableHead.classList.toggle('hidden', isLinksListView());
    }
    if (linksTableHead) {
        linksTableHead.classList.toggle('hidden', !isLinksListView());
    }
}

function updateDetailTabsVisibility() {
    document.querySelectorAll('.page-view-tab').forEach((el) => {
        el.classList.toggle('hidden', isLinksListView());
    });
    document.querySelectorAll('.link-view-tab').forEach((el) => {
        el.classList.toggle('hidden', !isLinksListView());
    });

    if (isLinksListView()) {
        if (!['link-details', 'link-sources'].includes(activeTab)) {
            activeTab = 'link-details';
        }
    } else if (activeTab === 'link-details' || activeTab === 'link-sources') {
        activeTab = 'details';
    }

    document.querySelectorAll('.detail-tab').forEach((btn) => {
        const isActive = btn.dataset.tab === activeTab;
        btn.classList.toggle('border-blue-600', isActive);
        btn.classList.toggle('text-blue-700', isActive);
        btn.classList.toggle('bg-white', isActive);
        btn.classList.toggle('border-transparent', !isActive);
        btn.classList.toggle('text-zinc-600', !isActive);
    });
}

function updatePageFiltersDisabled() {
    const disabled = isLinksListView();
    for (const el of [statusFilter, indexingFilter, h1Filter, duplicateFilter]) {
        if (el) {
            el.disabled = disabled;
            el.classList.toggle('opacity-50', disabled);
        }
    }
    rebuildContentTypeFilterOptions();
}

function buildFieldDuplicateCounts(getValue) {
    const counts = new Map();
    for (const data of scanResults.values()) {
        const key = normalizeDuplicateKey(getValue(data));
        if (!key) {
            continue;
        }
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function buildH1DuplicateCounts() {
    const counts = new Map();
    for (const data of scanResults.values()) {
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

function getDuplicateCounts() {
    if (!duplicateCountsCache) {
        duplicateCountsCache = {
            h1: buildH1DuplicateCounts(),
            title: buildFieldDuplicateCounts((data) => data.title),
            description: buildFieldDuplicateCounts((data) => data.metaDescription),
        };
    }
    return duplicateCountsCache;
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

function setScanHostnameFromUrl(startUrl) {
    try {
        scanHostname = new URL(startUrl).hostname;
    } catch {
        scanHostname = '';
    }
}

function getScanHostname() {
    if (scanHostname) {
        return scanHostname;
    }
    try {
        return new URL(urlInput.value.trim()).hostname;
    } catch {
        return '';
    }
}

function isExternalOutlink(link) {
    if (typeof link.external === 'boolean') {
        return link.external;
    }
    const href = link.href || link;
    const host = getScanHostname();
    if (!host) {
        return false;
    }
    try {
        return new URL(href).hostname !== host;
    } catch {
        return false;
    }
}

function countExternalOutlinks(data) {
    return (data.outlinks || []).filter(isExternalOutlink).length;
}

function passesTableFilters(data) {
    if (activeContentFilter !== 'all' && !pageMatchesContentTypeFilter(data, activeContentFilter)) {
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
        if (activeDuplicateFilter === 'title' && !hasDuplicateField(data.title, counts.title)) {
            return false;
        }
        if (activeDuplicateFilter === 'description' && !hasDuplicateField(data.metaDescription, counts.description)) {
            return false;
        }
    }
    return true;
}

function getFilteredResults() {
    return Array.from(scanResults.values()).filter(passesTableFilters);
}

function getDisplayedResults() {
    const entries = getFilteredResults();
    if (sortState.column) {
        entries.sort(compareRows);
    } else {
        entries.sort((a, b) => insertionOrder.indexOf(a.url) - insertionOrder.indexOf(b.url));
    }
    return entries;
}

function updateStatusFilterOptions({ force = false } = {}) {
    if (!statusFilter) {
        return;
    }

    const numericStatuses = new Set();
    for (const data of scanResults.values()) {
        if (typeof data.status === 'number') {
            numericStatuses.add(data.status);
        }
    }

    const statusesUnchanged = !force
        && numericStatuses.size === knownStatusCodes.size
        && [...numericStatuses].every((code) => knownStatusCodes.has(code));
    if (statusesUnchanged) {
        return;
    }
    knownStatusCodes = numericStatuses;

    const staticOptions = [
        { value: 'all', label: 'Усі' },
        { value: '2xx', label: '2xx' },
        { value: '3xx', label: '3xx' },
        { value: '4xx', label: '4xx' },
        { value: '5xx', label: '5xx' },
        { value: 'SKIPPED', label: 'SKIPPED' },
        { value: 'ERROR', label: 'Помилка мережі' },
    ];

    const exactOptions = [...numericStatuses].sort((a, b) => a - b).map((code) => ({
        value: String(code),
        label: String(code),
    }));

    statusFilter.innerHTML = '';

    const defaultGroup = document.createElement('optgroup');
    defaultGroup.label = 'Групи';
    for (const option of staticOptions) {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        defaultGroup.appendChild(el);
    }
    statusFilter.appendChild(defaultGroup);

    if (exactOptions.length > 0) {
        const exactGroup = document.createElement('optgroup');
        exactGroup.label = 'Точний код';
        for (const option of exactOptions) {
            const el = document.createElement('option');
            el.value = option.value;
            el.textContent = option.label;
            exactGroup.appendChild(el);
        }
        statusFilter.appendChild(exactGroup);
    }

    const hasCurrent = [...statusFilter.options].some((opt) => opt.value === activeStatusFilter);
    if (!hasCurrent) {
        activeStatusFilter = 'all';
    }
    statusFilter.value = activeStatusFilter;
}

function updateFilterCount(shown, total) {
    if (!filterCount) {
        return;
    }
    if (shown === total) {
        filterCount.textContent = total > 0 ? `Усього: ${total}` : '';
    } else {
        filterCount.textContent = `Показано: ${shown} з ${total}`;
    }
}

function resetTableFilters() {
    activeContentFilter = 'all';
    activeStatusFilter = 'all';
    activeIndexingFilter = 'all';
    activeH1Filter = 'all';
    activeDuplicateFilter = 'all';
    activeViewMode = 'pages';
    knownStatusCodes = new Set();
    invalidateDuplicateCounts();
    invalidateLinksIndex();
    if (statusFilter) {
        statusFilter.value = 'all';
    }
    if (indexingFilter) {
        indexingFilter.value = 'all';
    }
    if (h1Filter) {
        h1Filter.value = 'all';
    }
    if (duplicateFilter) {
        duplicateFilter.value = 'all';
    }
    if (externalLinksFilter) {
        externalLinksFilter.value = 'pages';
    }
    rebuildContentTypeFilterOptions({ preserveValue: false });
    updateTableHeadMode();
    updateDetailTabsVisibility();
    updatePageFiltersDisabled();
    updateStatusFilterOptions({ force: true });
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

function urlActionButtons(url) {
    const encoded = encodeURIComponent(url);
    return `<span class="inline-flex items-center gap-0.5 shrink-0 ml-1">
        <button type="button" class="url-copy px-1 py-0.5 text-zinc-400 hover:text-zinc-700 rounded" data-url="${encoded}" title="Копіювати">📋</button>
        <button type="button" class="url-open px-1 py-0.5 text-zinc-400 hover:text-zinc-700 rounded" data-url="${encoded}" title="Відкрити в браузері">↗</button>
    </span>`;
}

function urlCellHtml(url) {
    if (!url) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    return `<span class="inline-flex items-start gap-1 min-w-0 max-w-full">
        <span class="text-blue-700 break-all">${escapeHtml(url)}</span>
        ${urlActionButtons(url)}
    </span>`;
}

function decodeUrlAttr(encoded) {
    try {
        return decodeURIComponent(encoded);
    } catch {
        return encoded;
    }
}

async function copyUrlToClipboard(url) {
    try {
        await navigator.clipboard.writeText(url);
        statusText.textContent = 'Посилання скопійовано';
    } catch {
        statusText.textContent = 'Не вдалося скопіювати';
    }
}

async function openUrlInBrowser(url) {
    const result = await window.api.openExternal(url);
    if (!result?.ok) {
        statusText.textContent = 'Не вдалося відкрити посилання';
    }
}

function updateExportButton() {
    const canExport = uiState === 'idle' || uiState === 'paused';
    const hasVisibleRows = isLinksListView()
        ? getDisplayedLinks().length > 0
        : getFilteredResults().length > 0;
    exportButton.disabled = !hasVisibleRows;
    exportButton.classList.toggle('hidden', !canExport || scanResults.size === 0);
}

function updateUrlInputProgress(progress = null) {
    if (!urlInputProgress) {
        return;
    }
    if (progress) {
        lastScanProgress = progress;
    }

    if (uiState === 'idle') {
        urlInputProgress.style.width = '0%';
        if (urlInputWrap) {
            urlInputWrap.classList.remove('url-input-scanning');
        }
        return;
    }

    if (urlInputWrap) {
        urlInputWrap.classList.add('url-input-scanning');
    }

    const snapshot = progress || lastScanProgress || {};
    const scanned = snapshot.scanned ?? 0;
    const queue = snapshot.queue ?? 0;
    const total = scanned + queue;
    const percent = total > 0 ? Math.min(100, Math.max(0, (scanned / total) * 100)) : 0;
    urlInputProgress.style.width = `${percent}%`;
}

function setUIState(state) {
    uiState = state;
    controlsIdle.classList.toggle('hidden', state !== 'idle');
    controlsRunning.classList.toggle('hidden', state !== 'running');
    controlsPaused.classList.toggle('hidden', state !== 'paused');
    urlInput.disabled = state === 'running';
    updateUrlInputProgress();
    if (state === 'idle' || state === 'paused') {
        updateExportButton();
    } else {
        exportButton.classList.add('hidden');
    }
}

function clearScanData() {
    invalidateDuplicateCounts();
    invalidateLinksIndex();
    latestReferrersByUrl = new Map();
    scanResults.clear();
    insertionOrder.length = 0;
    selectedUrl = null;
    selectedLinkUrl = null;
    sortState = { column: null, direction: 'asc' };
    updateSortIndicators();
    resultsTable.innerHTML = '';
    selectedUrlHint.textContent = 'Оберіть рядок у таблиці';
    if (selectedUrlBar) {
        selectedUrlBar.querySelectorAll('.url-copy, .url-open').forEach((el) => el.remove());
    }
    detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть URL у таблиці вище</p>';
}

function clearScanResults() {
    clearScanData();
    resetTableFilters();
    updateExportButton();
    clearWorkspaceSession();
}

function collectWorkspaceSnapshot() {
    return {
        ...buildWorkspaceSnapshot({
            scanResults,
            insertionOrder,
            startUrl: urlInput.value.trim(),
            lastScanProgress,
            selectedUrl: isLinksListView() ? null : selectedUrl,
            statusHint: statusText.textContent,
            filters: {
                content: activeContentFilter,
                status: activeStatusFilter,
                indexing: activeIndexingFilter,
                h1: activeH1Filter,
                duplicate: activeDuplicateFilter,
                viewMode: activeViewMode,
            },
        }),
        selectedLinkUrl: isLinksListView() ? selectedLinkUrl : null,
    };
}

function persistWorkspaceNow() {
    if (workspacePersistTimer) {
        clearTimeout(workspacePersistTimer);
        workspacePersistTimer = null;
    }
    if (scanResults.size === 0) {
        clearWorkspaceSession();
        return;
    }
    saveWorkspaceToSession(collectWorkspaceSnapshot());
}

function scheduleWorkspacePersist() {
    if (workspacePersistTimer) {
        return;
    }
    workspacePersistTimer = setTimeout(() => {
        workspacePersistTimer = null;
        persistWorkspaceNow();
    }, WORKSPACE_PERSIST_DELAY_MS);
}

function applyFilterState(filters) {
    activeStatusFilter = filters.status || 'all';
    activeIndexingFilter = filters.indexing || 'all';
    activeH1Filter = filters.h1 || 'all';
    activeDuplicateFilter = filters.duplicate || 'all';
    activeViewMode = normalizeViewMode(filters.viewMode || filters.externalLinks);
    activeContentFilter = filters.content || filters.externalType || 'all';
    if (statusFilter) {
        statusFilter.value = activeStatusFilter;
    }
    if (indexingFilter) {
        indexingFilter.value = activeIndexingFilter;
    }
    if (h1Filter) {
        h1Filter.value = activeH1Filter;
    }
    if (duplicateFilter) {
        duplicateFilter.value = activeDuplicateFilter;
    }
    if (externalLinksFilter) {
        externalLinksFilter.value = activeViewMode;
    }
    rebuildContentTypeFilterOptions();
    updateTableHeadMode();
    updateDetailTabsVisibility();
    updatePageFiltersDisabled();
    updateStatusFilterOptions({ force: true });
}

function populateScanResults(normalized) {
    clearScanData();
    urlInput.value = normalized.startUrl;
    setScanHostnameFromUrl(normalized.startUrl);

    const resultMap = new Map(normalized.results.map((entry) => [entry.url, entry]));
    for (const url of normalized.insertionOrder) {
        if (resultMap.has(url)) {
            insertionOrder.push(url);
            scanResults.set(url, resultMap.get(url));
        }
    }
    for (const entry of normalized.results) {
        if (!scanResults.has(entry.url)) {
            insertionOrder.push(entry.url);
            scanResults.set(entry.url, entry);
        }
    }
    rebuildLatestReferrersFromResults();
}

function restoreWorkspaceFromSession() {
    const workspace = loadWorkspaceFromSession();
    if (!workspace?.results?.length) {
        return false;
    }

    const normalized = normalizeLoadedDump({
        version: SESSION_DUMP_VERSION,
        startUrl: workspace.startUrl,
        insertionOrder: workspace.insertionOrder,
        results: workspace.results,
        progressAtSave: workspace.lastScanProgress,
    });

    populateScanResults(normalized);
    if (workspace.filters) {
        applyFilterState(workspace.filters);
    }

    lastScanProgress = workspace.lastScanProgress || null;
    requestRefreshTable({ immediate: true });
    updateUrlInputProgress(lastScanProgress);
    statusScanned.textContent = `Проскановано: ${scanResults.size}`;
    statusQueue.textContent = 'У черзі: 0';
    if (statusActive) {
        statusActive.textContent = 'Активних: 0';
    }
    if (statusRate) {
        statusRate.textContent = 'Швидкість: —';
    }
    if (workspace.statusHint) {
        statusText.textContent = workspace.statusHint;
    }

    if (isLinksListView()) {
        const linkUrl = workspace.selectedLinkUrl || workspace.selectedExternalUrl;
        if (linkUrl && getLinkEntry(linkUrl)) {
            selectLinkRow(linkUrl);
        }
    } else if (workspace.selectedUrl && scanResults.has(workspace.selectedUrl)) {
        selectRow(workspace.selectedUrl);
    }

    updateExportButton();
    return true;
}

async function beginScan(startUrl, { clearResults = true } = {}) {
    if (clearResults) {
        clearScanResults();
    }
    setScanHostnameFromUrl(startUrl);
    lastScanProgress = null;
    setUIState('running');
    updateUrlInputProgress({ scanned: 0, queue: 0 });
    statusText.textContent = `Починаю сканування з ${startUrl}...`;

    const settings = await loadSettings();
    window.api.startSpider(startUrl, {
        useSitemap: settings.useSitemap,
        maxPages: settings.maxPages,
        concurrency: settings.concurrency,
    });
}

function getRowMetrics(data) {
    const outlinks = data.outlinks || [];
    return {
        inCount: getReferrersForUrl(data.url).length,
        linkCount: data.linkCount ?? outlinks.length,
        externalCount: countExternalOutlinks(data),
    };
}

function compareRows(a, b) {
    const { column, direction } = sortState;
    const mul = direction === 'asc' ? 1 : -1;
    const ma = getRowMetrics(a);
    const mb = getRowMetrics(b);

    let va;
    let vb;
    switch (column) {
        case 'index':
            va = insertionOrder.indexOf(a.url);
            vb = insertionOrder.indexOf(b.url);
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
        case 'responseTime':
            va = a.responseTimeMs ?? -1;
            vb = b.responseTimeMs ?? -1;
            break;
        case 'title':
            va = (a.title || '').toLowerCase();
            vb = (b.title || '').toLowerCase();
            break;
        case 'h1':
            va = getPrimaryH1Text(a).toLowerCase();
            vb = getPrimaryH1Text(b).toLowerCase();
            break;
        case 'metaDescription':
            va = (a.metaDescription || '').toLowerCase();
            vb = (b.metaDescription || '').toLowerCase();
            break;
        case 'links':
            va = ma.linkCount;
            vb = mb.linkCount;
            break;
        case 'inlinks':
            va = ma.inCount;
            vb = mb.inCount;
            break;
        default:
            va = insertionOrder.indexOf(a.url);
            vb = insertionOrder.indexOf(b.url);
    }

    if (va < vb) return -1 * mul;
    if (va > vb) return 1 * mul;
    return a.url.localeCompare(b.url) * mul;
}

function updateSortIndicators() {
    document.querySelectorAll('.sortable-th').forEach((th) => {
        const col = th.dataset.sort;
        const base = th.textContent.replace(/ [▲▼]$/, '');
        if (sortState.column === col) {
            th.textContent = `${base} ${sortState.direction === 'asc' ? '▲' : '▼'}`;
            th.classList.add('bg-zinc-200', 'text-zinc-800');
        } else {
            th.textContent = base;
            th.classList.remove('bg-zinc-200', 'text-zinc-800');
        }
    });
}

function formatLinkScopeLabel(external) {
    return external ? 'Зовнішнє' : 'Внутрішнє';
}

function createLinkTableRow(entry, displayIndex) {
    const tr = document.createElement('tr');
    tr.dataset.linkUrl = entry.href;
    tr.className = `border-b border-zinc-100 cursor-pointer hover:bg-zinc-50${entry.external ? ' bg-amber-50/20' : ''}`;
    if (selectedLinkUrl === entry.href) {
        tr.classList.add('bg-blue-50');
    }
    const scopeClass = entry.external ? 'text-amber-700' : 'text-emerald-700';
    tr.innerHTML = `
        <td class="p-2 text-zinc-400">${displayIndex}</td>
        <td class="p-2">${urlCellHtml(entry.href)}</td>
        <td class="p-2 whitespace-nowrap ${scopeClass} font-medium">${formatLinkScopeLabel(entry.external)}</td>
        <td class="p-2 font-mono text-zinc-600">${entry.host ? escapeHtml(entry.host) : '<span class="text-zinc-400 italic">—</span>'}</td>
        <td class="p-2 text-zinc-600" title="${escapeHtml(entry.kinds.join(', '))}">${escapeHtml(formatOutlinkKindLabel(entry.kind))}${entry.kinds.length > 1 ? `<span class="text-zinc-400 text-[10px]">+${entry.kinds.length - 1}</span>` : ''}</td>
        <td class="p-2 font-mono text-zinc-600 text-[11px]" title="${escapeHtml(entry.tags.join(', '))}">${escapeHtml(entry.tag)}${entry.tags.length > 1 ? `<span class="text-zinc-400 text-[10px]">+${entry.tags.length - 1}</span>` : ''}</td>
        <td class="p-2 text-center font-semibold">${entry.sourceCount}</td>
        <td class="p-2 text-zinc-600" title="${escapeHtml(entry.sampleText)}">${entry.sampleText ? escapeHtml(truncate(entry.sampleText, 60)) : '<span class="text-zinc-400 italic">—</span>'}</td>
    `;
    tr.addEventListener('click', (e) => {
        if (e.target.closest('.url-copy, .url-open')) {
            return;
        }
        selectLinkRow(entry.href);
    });
    return tr;
}

function createTableRow(data, displayIndex) {
    const { inCount, linkCount, externalCount } = getRowMetrics(data);
    const dupCounts = getDuplicateCounts();
    const linksTitle = externalCount > 0
        ? `Всього: ${linkCount}, зовнішніх: ${externalCount}`
        : '';
    const titleDup = getTextDuplicateCount(data.title, dupCounts.title);
    const descDup = getTextDuplicateCount(data.metaDescription, dupCounts.description);
    const tr = document.createElement('tr');
    tr.dataset.url = data.url;
    tr.className = 'border-b border-zinc-100 cursor-pointer hover:bg-zinc-50';
    if (selectedUrl === data.url) {
        tr.classList.add('bg-blue-50');
    }
    tr.innerHTML = `
        <td class="p-2 text-zinc-400">${displayIndex}</td>
        <td class="p-2">${urlCellHtml(data.url)}</td>
        <td class="p-2"><span class="font-mono font-semibold ${statusRowClass(data.status)}">${escapeHtml(data.status)}</span></td>
        <td class="p-2 font-mono text-zinc-600" title="${escapeHtml(data.contentType || '')}">${data.contentType ? escapeHtml(truncate(data.contentType, 28)) : '<span class="text-zinc-400 italic">—</span>'}</td>
        <td class="p-2 text-right">${formatResponseTimeMs(data.responseTimeMs)}</td>
        <td class="p-2">${metaRobotsCellHtml(data)}</td>
        <td class="p-2">${robotsTxtCellHtml(data)}</td>
        <td class="p-2">${h1CellHtml(data, dupCounts)}</td>
        <td class="p-2" title="${escapeHtml(data.title)}">${escapeHtml(truncate(data.title, 50))}${duplicateCountBadge(titleDup)}</td>
        <td class="p-2" title="${escapeHtml(data.metaDescription)}">${escapeHtml(truncate(data.metaDescription, 60))}${duplicateCountBadge(descDup)}</td>
        <td class="p-2 text-center"${linksTitle ? ` title="${escapeHtml(linksTitle)}"` : ''}>${linkCount}${externalCount > 0 ? `<span class="text-amber-600 text-[10px] ml-0.5" title="${escapeHtml(linksTitle)}">+${externalCount}</span>` : ''}</td>
        <td class="p-2 text-center">${inCount}</td>
    `;
    tr.addEventListener('click', (e) => {
        if (e.target.closest('.url-copy, .url-open')) {
            return;
        }
        selectRow(data.url);
    });
    return tr;
}

function refreshTable() {
    updateTableHeadMode();
    updateDetailTabsVisibility();
    updatePageFiltersDisabled();

    if (isLinksListView()) {
        const allInScope = getLinksIndex().filter(passesLinkScopeFilter);
        const entries = getDisplayedLinks();
        resultsTable.innerHTML = '';
        entries.forEach((entry, i) => {
            resultsTable.appendChild(createLinkTableRow(entry, i + 1));
        });

        updateFilterCount(entries.length, allInScope.length);
        if (uiState === 'idle' || uiState === 'paused') {
            updateExportButton();
        }

        if (selectedLinkUrl && !entries.some((row) => row.href === selectedLinkUrl)) {
            document.querySelectorAll('#resultsTable tr').forEach((tr) => {
                tr.classList.remove('bg-blue-50');
            });
            detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть посилання у таблиці вище</p>';
        } else if (selectedLinkUrl && getLinkEntry(selectedLinkUrl)) {
            syncSelectedLinkRowUi();
        }
        return;
    }

    updateStatusFilterOptions();

    const entries = getDisplayedResults();

    resultsTable.innerHTML = '';
    entries.forEach((data, i) => {
        resultsTable.appendChild(createTableRow(data, i + 1));
    });

    updateFilterCount(entries.length, scanResults.size);
    if (uiState === 'idle' || uiState === 'paused') {
        updateExportButton();
    }

    if (selectedUrl && !entries.some((row) => row.url === selectedUrl)) {
        document.querySelectorAll('#resultsTable tr').forEach((tr) => {
            tr.classList.remove('bg-blue-50');
        });
    } else if (selectedUrl && scanResults.has(selectedUrl)) {
        syncSelectedRowUi();
    }
}

function syncSelectedRowUi() {
    if (!selectedUrl || !scanResults.has(selectedUrl)) {
        return;
    }
    selectedUrlHint.textContent = truncate(selectedUrl, 80);
    selectedUrlHint.title = selectedUrl;
    if (selectedUrlBar) {
        selectedUrlBar.querySelectorAll('.url-copy, .url-open').forEach((el) => el.remove());
        const actions = document.createElement('span');
        actions.innerHTML = urlActionButtons(selectedUrl);
        selectedUrlBar.appendChild(actions);
    }
    renderDetailPanel();
}

function syncSelectedLinkRowUi() {
    if (!selectedLinkUrl || !getLinkEntry(selectedLinkUrl)) {
        return;
    }
    selectedUrlHint.textContent = truncate(selectedLinkUrl, 80);
    selectedUrlHint.title = selectedLinkUrl;
    if (selectedUrlBar) {
        selectedUrlBar.querySelectorAll('.url-copy, .url-open').forEach((el) => el.remove());
        const actions = document.createElement('span');
        actions.innerHTML = urlActionButtons(selectedLinkUrl);
        selectedUrlBar.appendChild(actions);
    }
    renderDetailPanel();
}

function requestRefreshTable({ immediate = false } = {}) {
    if (immediate) {
        if (refreshTableTimer) {
            clearTimeout(refreshTableTimer);
            refreshTableTimer = null;
        }
        refreshTable();
        return;
    }

    if (refreshTableTimer) {
        return;
    }

    const delay = uiState === 'running' ? REFRESH_TABLE_DELAY_MS : 0;
    refreshTableTimer = setTimeout(() => {
        refreshTableTimer = null;
        refreshTable();
    }, delay);
}

function upsertScanResult(data) {
    if (!data.outlinks) {
        data.outlinks = [];
    }
    invalidateDuplicateCounts();
    invalidateLinksIndex();
    const isNew = !scanResults.has(data.url);
    if (isNew) {
        insertionOrder.push(data.url);
    }
    scanResults.set(data.url, data);
    requestRefreshTable();
    scheduleWorkspacePersist();

    if (isNew && !selectedUrl && isPagesListView()) {
        selectedUrl = data.url;
    } else if (selectedUrl === data.url) {
        renderDetailPanel();
    } else if (selectedLinkUrl && isLinksListView()) {
        renderDetailPanel();
    }
}

function setActiveTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.detail-tab').forEach((btn) => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('border-blue-600', isActive);
        btn.classList.toggle('text-blue-700', isActive);
        btn.classList.toggle('bg-white', isActive);
        btn.classList.toggle('border-transparent', !isActive);
        btn.classList.toggle('text-zinc-600', !isActive);
    });
    renderDetailPanel();
}

document.querySelectorAll('.detail-tab').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

if (contentTypeFilter) {
    contentTypeFilter.addEventListener('change', () => {
        activeContentFilter = contentTypeFilter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (statusFilter) {
    statusFilter.addEventListener('change', () => {
        activeStatusFilter = statusFilter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (indexingFilter) {
    indexingFilter.addEventListener('change', () => {
        activeIndexingFilter = indexingFilter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (h1Filter) {
    h1Filter.addEventListener('change', () => {
        activeH1Filter = h1Filter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (duplicateFilter) {
    duplicateFilter.addEventListener('change', () => {
        activeDuplicateFilter = duplicateFilter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (externalLinksFilter) {
    externalLinksFilter.addEventListener('change', () => {
        activeViewMode = normalizeViewMode(externalLinksFilter.value);
        if (isLinksListView()) {
            selectedUrl = null;
            if (!selectedLinkUrl) {
                sortState = { column: 'url', direction: 'asc' };
                updateSortIndicators();
            }
        } else {
            selectedLinkUrl = null;
        }
        knownPresentContentTypesKey = '';
        rebuildContentTypeFilterOptions({ preserveValue: true });
        updateTableHeadMode();
        updateDetailTabsVisibility();
        updatePageFiltersDisabled();
        requestRefreshTable({ immediate: true });
        scheduleWorkspacePersist();
    });
}

document.querySelectorAll('.sortable-th').forEach((th) => {
    th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (sortState.column === col) {
            sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.column = col;
            sortState.direction = 'asc';
        }
        updateSortIndicators();
        requestRefreshTable({ immediate: true });
    });
});

function selectRow(url) {
    selectedUrl = url;
    selectedLinkUrl = null;
    document.querySelectorAll('#resultsTable tr').forEach((tr) => {
        tr.classList.toggle('bg-blue-50', tr.dataset.url === url);
    });
    syncSelectedRowUi();
    scheduleWorkspacePersist();
}

function selectLinkRow(href) {
    selectedLinkUrl = href;
    selectedUrl = null;
    document.querySelectorAll('#resultsTable tr').forEach((tr) => {
        tr.classList.toggle('bg-blue-50', tr.dataset.linkUrl === href);
    });
    syncSelectedLinkRowUi();
    scheduleWorkspacePersist();
}

function renderDetailTable(rows) {
    if (rows.length === 0) {
        return '<p class="p-4 text-zinc-400 italic">Немає даних</p>';
    }
    const body = rows
        .map(
            ([name, value]) => `
        <tr class="border-b border-zinc-100 hover:bg-zinc-50">
            <td class="p-2 font-medium text-zinc-500 align-top w-40 whitespace-nowrap">${escapeHtml(name)}</td>
            <td class="p-2 text-zinc-800 break-all">${value}</td>
        </tr>`
        )
        .join('');
    return `<table class="w-full border-collapse"><tbody>${body}</tbody></table>`;
}

function renderLinkTable(links, emptyText, caption = '') {
    if (!links || links.length === 0) {
        return `<p class="p-4 text-zinc-400 italic">${escapeHtml(emptyText)}</p>`;
    }
    const captionHtml = caption
        ? `<p class="px-4 py-2 text-xs text-zinc-500 border-b border-zinc-100 bg-zinc-50">${escapeHtml(caption)}</p>`
        : '';
    const rows = links
        .map(
            (link) => {
                const external = isExternalOutlink(link);
                const typeBadge = external
                    ? '<span class="inline-block ml-1 px-1 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 whitespace-nowrap" title="Зовнішнє посилання — не обходиться">зовн.</span>'
                    : '';
                const kind = getOutlinkKind(link);
                const tag = getOutlinkTag(link);
                const relInfo = getLinkRelInfo(link);
                const relCell = relInfo.applicable
                    ? (relInfo.rel
                        ? `<span class="font-mono">${escapeHtml(relInfo.rel)}</span>`
                        : '<span class="text-zinc-500 italic">follow</span>')
                    : '<span class="text-zinc-400 italic">—</span>';
                return `
        <tr class="border-b border-zinc-100 hover:bg-zinc-50${external ? ' bg-amber-50/40' : ''}">
            <td class="p-2">${urlCellHtml(link.href || link)}${typeBadge}</td>
            <td class="p-2 text-zinc-500 whitespace-nowrap">${escapeHtml(formatOutlinkKindLabel(kind))}</td>
            <td class="p-2 font-mono text-zinc-600 text-[11px] whitespace-nowrap">${escapeHtml(tag)}</td>
            <td class="p-2 text-zinc-600">${relCell}</td>
            <td class="p-2 whitespace-nowrap">${formatRelAllowedStatus(relInfo.relFollowAllowed)}</td>
            <td class="p-2 text-zinc-600">${link.text ? escapeHtml(link.text) : '<span class="text-zinc-400 italic">—</span>'}</td>
        </tr>`;
            }
        )
        .join('');
    return `${captionHtml}<table class="w-full border-collapse">
        <thead class="bg-zinc-50 sticky top-0">
            <tr class="text-left text-zinc-500">
                <th class="p-2 font-semibold">URL</th>
                <th class="p-2 font-semibold w-24">Тип</th>
                <th class="p-2 font-semibold min-w-[110px]">Тег</th>
                <th class="p-2 font-semibold min-w-[90px]">rel</th>
                <th class="p-2 font-semibold w-24">Перехід</th>
                <th class="p-2 font-semibold w-1/3">Текст посилання</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function buildDetailRows(data) {
    const h1List = (data.headings || []).filter((h) => h.level === 1);
    const h1 = h1List[0];
    const h2List = (data.headings || []).filter((h) => h.level === 2);
    const { inCount, linkCount, externalCount } = getRowMetrics(data);
    const internalCount = linkCount - externalCount;

    const rows = [
        ['Address', urlCellHtml(data.url)],
        ['Status Code', escapeHtml(data.status)],
        ['Content-Type', escapeHtml(data.contentType) || '<span class="text-zinc-400 italic">—</span>'],
        ['Response Time (ms)', data.responseTimeMs ?? '—'],
        ['Resource Type', getResourceType(data) === 'html' ? 'HTML' : 'Медіа'],
        ['Title', escapeHtml(data.title)],
        ['Title Length', data.title ? String(data.title.length) : '0'],
        ['Meta Description', escapeHtml(data.metaDescription) || '<span class="text-zinc-400 italic">—</span>'],
        ['Meta Description Length', data.metaDescription ? String(data.metaDescription.length) : '0'],
        ['Canonical', data.metaCanonical ? urlCellHtml(data.metaCanonical) : '<span class="text-zinc-400 italic">—</span>'],
        ['Meta robots', formatMetaRobotsDetail(data)],
        ['Robots.txt', formatRobotsTxtDetail(data)],
        ['H1 Count', String(getH1Count(data))],
        [
            'H1',
            h1List.length
                ? h1List.map((h) => escapeHtml(h.text)).join('<br>')
                : '<span class="text-zinc-400 italic">—</span>',
        ],
        [
            'H2',
            h2List.length
                ? h2List.map((h) => escapeHtml(h.text)).join('<br>')
                : '<span class="text-zinc-400 italic">—</span>',
        ],
        ['Вихідних посилань', String(linkCount)],
        ['Зовнішніх посилань', externalCount > 0 ? String(externalCount) : '<span class="text-zinc-400 italic">0</span>'],
        ['Внутрішніх посилань', String(internalCount)],
        ['Вхідних посилань', String(inCount)],
    ];

    const dupCounts = getDuplicateCounts();
    const titleDup = getTextDuplicateCount(data.title, dupCounts.title);
    const descDup = getTextDuplicateCount(data.metaDescription, dupCounts.description);
    if (titleDup > 1) {
        rows.push(['Дублікатів Title', `<span class="text-amber-600 font-semibold">${titleDup} сторінок</span>`]);
    }
    if (descDup > 1) {
        rows.push(['Дублікатів Meta Description', `<span class="text-amber-600 font-semibold">${descDup} сторінок</span>`]);
    }
    const h1DupEntries = getH1Texts(data)
        .map((text) => ({
            text,
            count: getTextDuplicateCount(text, dupCounts.h1),
        }))
        .filter((entry) => entry.count > 1);
    if (h1DupEntries.length) {
        rows.push([
            'Дублікатів H1',
            h1DupEntries
                .map((entry) => `${escapeHtml(entry.text)} — ${entry.count} стор.`)
                .join('<br>'),
        ]);
    }

    if (data.redirectUrl) {
        rows.push(['Redirect URL', urlCellHtml(data.redirectUrl)]);
    }

    return rows;
}

function renderSourcePagesTable(sources, emptyText, caption = '') {
    if (!sources || sources.length === 0) {
        return `<p class="p-4 text-zinc-400 italic">${escapeHtml(emptyText)}</p>`;
    }
    const captionHtml = caption
        ? `<p class="px-4 py-2 text-xs text-zinc-500 border-b border-zinc-100 bg-zinc-50">${escapeHtml(caption)}</p>`
        : '';
    const rows = sources
        .map(
            (source) => {
                const relInfo = getLinkRelInfo(source);
                const relCell = relInfo.applicable
                    ? (relInfo.rel
                        ? `<span class="font-mono">${escapeHtml(relInfo.rel)}</span>`
                        : '<span class="text-zinc-500 italic">follow</span>')
                    : '<span class="text-zinc-400 italic">—</span>';
                return `
        <tr class="border-b border-zinc-100 hover:bg-zinc-50">
            <td class="p-2">${urlCellHtml(source.pageUrl)}</td>
            <td class="p-2 text-zinc-500 whitespace-nowrap">${escapeHtml(formatOutlinkKindLabel(source.kind))}</td>
            <td class="p-2 font-mono text-zinc-600 text-[11px] whitespace-nowrap">${escapeHtml(source.tag || '—')}</td>
            <td class="p-2 text-zinc-600">${relCell}</td>
            <td class="p-2 whitespace-nowrap">${formatRelAllowedStatus(relInfo.relFollowAllowed)}</td>
            <td class="p-2 whitespace-nowrap">${formatRelAllowedStatus(relInfo.relIndexAllowed)}</td>
            <td class="p-2 text-zinc-600">${source.text ? escapeHtml(source.text) : '<span class="text-zinc-400 italic">—</span>'}</td>
        </tr>`;
            }
        )
        .join('');
    return `${captionHtml}<table class="w-full border-collapse">
        <thead class="bg-zinc-50 sticky top-0">
            <tr class="text-left text-zinc-500">
                <th class="p-2 font-semibold">Сторінка</th>
                <th class="p-2 font-semibold w-24">Тип</th>
                <th class="p-2 font-semibold min-w-[110px]">Тег</th>
                <th class="p-2 font-semibold min-w-[90px]">rel</th>
                <th class="p-2 font-semibold w-24">Перехід</th>
                <th class="p-2 font-semibold w-24">Індексація</th>
                <th class="p-2 font-semibold w-1/3">Текст посилання</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function buildLinkDetailRows(entry) {
    const kindLabel = entry.kinds.length > 1
        ? entry.kinds.map((kind) => formatOutlinkKindLabel(kind)).join(', ')
        : formatOutlinkKindLabel(entry.kind);
    const tagLabel = entry.tags.length > 1
        ? entry.tags.join(', ')
        : entry.tag;
    const relSummary = summarizeEntryRelInfo(entry.sources);
    const rows = [
        ['URL', urlCellHtml(entry.href)],
        ['Область', escapeHtml(formatLinkScopeLabel(entry.external))],
        ['Host', entry.host ? escapeHtml(entry.host) : '<span class="text-zinc-400 italic">—</span>'],
        ['Тип', escapeHtml(kindLabel)],
        ['Тег', `<span class="font-mono">${escapeHtml(tagLabel)}</span>`],
        ['Сторінок-джерел', String(entry.sourceCount)],
        ['Текст посилання', entry.sampleText ? escapeHtml(entry.sampleText) : '<span class="text-zinc-400 italic">—</span>'],
    ];

    if (relSummary.applicable) {
        rows.push([
            'rel',
            relSummary.rel
                ? `<span class="font-mono">${escapeHtml(relSummary.rel)}</span>`
                : '<span class="text-zinc-500 italic">follow (за замовчуванням)</span>',
        ]);
        rows.push([
            'Перехід по посиланню',
            relSummary.mixed
                ? '<span class="text-zinc-500 italic">Різні значення на сторінках-джерелах</span>'
                : formatRelAllowedStatus(relSummary.relFollowAllowed),
        ]);
        rows.push([
            'Індексація (передача сигналу)',
            relSummary.mixed
                ? '<span class="text-zinc-500 italic">Різні значення на сторінках-джерелах</span>'
                : formatRelAllowedStatus(relSummary.relIndexAllowed),
        ]);
        if (relSummary.relLabel && relSummary.relLabel !== 'follow') {
            rows.push(['Маркери rel', escapeHtml(relSummary.relLabel)]);
        }
    } else {
        rows.push(['rel', '<span class="text-zinc-400 italic">Не застосовується для цього тега</span>']);
    }

    return rows;
}

function renderDetailPanel() {
    if (isLinksListView()) {
        if (!selectedLinkUrl) {
            detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть посилання у таблиці вище</p>';
            return;
        }
        const entry = getLinkEntry(selectedLinkUrl);
        if (!entry) {
            detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Посилання не знайдено</p>';
            return;
        }
        if (activeTab === 'link-sources') {
            detailContent.innerHTML = renderSourcePagesTable(
                entry.sources,
                'Немає сторінок-джерел',
                `Знайдено на ${entry.sourceCount} стор.`
            );
        } else {
            detailContent.innerHTML = renderDetailTable(buildLinkDetailRows(entry));
        }
        return;
    }

    if (!selectedUrl || !scanResults.has(selectedUrl)) {
        detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть URL у таблиці вище</p>';
        return;
    }

    const data = scanResults.get(selectedUrl);

    if (activeTab === 'details') {
        detailContent.innerHTML = renderDetailTable(buildDetailRows(data));
    } else if (activeTab === 'inlinks') {
        const inlinks = getReferrersForUrl(data.url);
        detailContent.innerHTML = renderLinkTable(
            inlinks,
            'Немає вхідних посилань (стартова або лише з sitemap)',
            inlinks.length ? `Всього вхідних: ${inlinks.length}` : ''
        );
    } else if (activeTab === 'outlinks') {
        detailContent.innerHTML = renderLinkTable(
            data.outlinks || [],
            'Немає вихідних посилань на сторінці'
        );
    }
}

exportButton.addEventListener('click', () => {
    const bom = '\uFEFF';

    if (isLinksListView()) {
        const entries = getDisplayedLinks();
        if (entries.length === 0) {
            alert('Немає посилань для експорту за поточними фільтрами.');
            return;
        }
        const headers = ['URL', 'Scope', 'Host', 'Type', 'Tag', 'Rel', 'Follow Allowed', 'Index Allowed', 'Source Pages Count', 'Source Pages', 'Link Texts', 'Source Types', 'Source Tags', 'Source Rels'];
        const csvRows = [headers.join(',')];
        for (const entry of entries) {
            const relSummary = summarizeEntryRelInfo(entry.sources);
            const pages = entry.sources.map((source) => source.pageUrl).join('; ');
            const texts = entry.sources.map((source) => source.text || '—').join('; ');
            const sourceTypes = entry.sources.map((source) => formatOutlinkKindLabel(source.kind)).join('; ');
            const sourceTags = entry.sources.map((source) => source.tag || '—').join('; ');
            const sourceRels = entry.sources.map((source) => getLinkRelInfo(source).rel || 'follow').join('; ');
            const kindLabel = entry.kinds.map((kind) => formatOutlinkKindLabel(kind)).join('; ');
            const tagLabel = entry.tags.join('; ');
            csvRows.push([
                `"${entry.href.replace(/"/g, '""')}"`,
                `"${formatLinkScopeLabel(entry.external)}"`,
                `"${entry.host.replace(/"/g, '""')}"`,
                `"${kindLabel.replace(/"/g, '""')}"`,
                `"${tagLabel.replace(/"/g, '""')}"`,
                `"${(relSummary.rel || 'follow').replace(/"/g, '""')}"`,
                `"${relSummary.relFollowAllowed === false ? 'Обмежено' : (relSummary.relFollowAllowed ? 'Дозволено' : 'Різні')}"`,
                `"${relSummary.relIndexAllowed === false ? 'Обмежено' : (relSummary.relIndexAllowed ? 'Дозволено' : 'Різні')}"`,
                `"${entry.sourceCount}"`,
                `"${pages.replace(/"/g, '""')}"`,
                `"${texts.replace(/"/g, '""')}"`,
                `"${sourceTypes.replace(/"/g, '""')}"`,
                `"${sourceTags.replace(/"/g, '""')}"`,
                `"${sourceRels.replace(/"/g, '""')}"`,
            ].join(','));
        }
        const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `spider_links_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        return;
    }

    const entries = getDisplayedResults();
    if (entries.length === 0) {
        alert('Немає рядків для експорту за поточними фільтрами.');
        return;
    }

    const headers = ['URL', 'Status', 'Meta Robots', 'Robots.txt Rule', 'Robots.txt Allowed', 'H1 Count', 'Content-Type', 'Response Time (ms)', 'Resource Type', 'Title', 'Meta Description', 'Canonical', 'Link Count', 'Redirect URL', 'Referrers', 'Outlinks', 'Headings'];
    const csvRows = [headers.join(',')];

    for (const data of entries) {
        const referrers = formatCsvUrlListPreview(getReferrersForUrl(data.url));
        const outlinks = formatCsvUrlListPreview(data.outlinks);
        const headings = data.headings ? data.headings.map((h) => `H${h.level}: ${h.text}`).join('; ') : '';
        const row = [
            `"${(data.url || '').replace(/"/g, '""')}"`,
            `"${(data.status || '')}"`,
            `"${(data.metaRobotsLabel || data.metaRobots || '').replace(/"/g, '""')}"`,
            `"${(data.robotsRule || '').replace(/"/g, '""')}"`,
            `"${data.robotsAllowed === false ? 'Заборонено' : (data.robotsAllowed ? 'Дозволено' : '')}"`,
            `"${getH1Count(data)}"`,
            `"${(data.contentType || '').replace(/"/g, '""')}"`,
            `"${data.responseTimeMs ?? ''}"`,
            `"${getResourceType(data)}"`,
            `"${(data.title || '').replace(/"/g, '""')}"`,
            `"${(data.metaDescription || '').replace(/"/g, '""')}"`,
            `"${(data.metaCanonical || '').replace(/"/g, '""')}"`,
            `"${(data.linkCount || 0)}"`,
            `"${(data.redirectUrl || '').replace(/"/g, '""')}"`,
            `"${referrers.replace(/"/g, '""')}"`,
            `"${outlinks.replace(/"/g, '""')}"`,
            `"${headings.replace(/"/g, '""')}"`,
        ];
        csvRows.push(row.join(','));
    }

    const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `spider_filtered_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
});

document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.url-copy');
    const openBtn = e.target.closest('.url-open');
    if (copyBtn) {
        e.stopPropagation();
        copyUrlToClipboard(decodeUrlAttr(copyBtn.dataset.url));
        return;
    }
    if (openBtn) {
        e.stopPropagation();
        openUrlInBrowser(decodeUrlAttr(openBtn.dataset.url));
    }
});

async function ensureCanReplaceSession(actionLabel) {
    if (uiState === 'idle') {
        return true;
    }
    const message = uiState === 'paused'
        ? `${actionLabel} зупинить паузу та замінить поточні результати. Продовжити?`
        : `${actionLabel} зупинить активне сканування та замінить поточні результати. Продовжити?`;
    if (!confirm(message)) {
        return false;
    }
    if (uiState === 'running' || uiState === 'paused') {
        window.api.stopSpider();
    }
    setUIState('idle');
    lastScanProgress = null;
    updateUrlInputProgress();
    return true;
}

async function saveSessionDumpToFile() {
    if (scanResults.size === 0) {
        alert('Немає результатів для збереження.');
        return;
    }
    const payload = buildSessionDumpPayload({
        scanResults,
        insertionOrder,
        startUrl: urlInput.value.trim(),
        uiState,
        lastScanProgress,
    });
    const result = await window.api.saveSessionDump(payload);
    if (result?.canceled) {
        return;
    }
    if (!result?.ok) {
        alert(result?.error || 'Не вдалося зберегти дамп.');
        return;
    }
    statusText.textContent = `Дамп збережено: ${result.filePath}`;
}

function applySessionDump(dump, filePath = '') {
    const normalized = normalizeLoadedDump({ ...dump, filePath });
    resetTableFilters();
    populateScanResults(normalized);

    selectedUrl = null;
    selectedLinkUrl = null;
    lastScanProgress = normalized.progressAtSave;
    requestRefreshTable({ immediate: true });
    setUIState('idle');
    updateUrlInputProgress(normalized.progressAtSave);
    statusScanned.textContent = `Проскановано: ${scanResults.size}`;
    statusQueue.textContent = 'У черзі: 0';
    if (statusActive) {
        statusActive.textContent = 'Активних: 0';
    }
    if (statusRate) {
        statusRate.textContent = 'Швидкість: —';
    }
    statusText.textContent = filePath
        ? `Завантажено дамп (${scanResults.size} URL): ${filePath}`
        : `Завантажено дамп: ${scanResults.size} URL`;
    persistWorkspaceNow();
}

async function loadSessionDumpFromFile() {
    const canContinue = await ensureCanReplaceSession('Завантаження дампу');
    if (!canContinue) {
        return;
    }
    const result = await window.api.loadSessionDump();
    if (result?.canceled) {
        return;
    }
    if (!result?.ok) {
        alert(result?.error || 'Не вдалося завантажити дамп.');
        return;
    }
    applySessionDump(result.dump, result.filePath || '');
}

async function handleMenuLoadedDump(payload) {
    if (!payload?.ok || !payload.dump) {
        return;
    }
    const canContinue = await ensureCanReplaceSession('Завантаження дампу');
    if (!canContinue) {
        return;
    }
    applySessionDump(payload.dump, payload.filePath || '');
}

window.api.onSessionDumpRequestSave(() => saveSessionDumpToFile());
window.api.onSessionDumpLoaded((payload) => handleMenuLoadedDump(payload));

startButton.addEventListener('click', async () => {
    const startUrl = urlInput.value.trim();
    try {
        new URL(startUrl);
        await beginScan(startUrl);
    } catch {
        alert('Будь ласка, введіть коректний URL (наприклад, https://example.com).');
    }
});

stopButton.addEventListener('click', async () => {
    if (uiState !== 'running') {
        return;
    }
    setUIState('paused');
    statusText.textContent = 'На паузі';
    if (refreshTableTimer) {
        clearTimeout(refreshTableTimer);
        refreshTableTimer = null;
    }
    requestRefreshTable({ immediate: true });
    await window.api.pauseSpider();
});

resumeButton.addEventListener('click', async () => {
    if (uiState !== 'paused') {
        return;
    }
    await window.api.resumeSpider();
    setUIState('running');
});

restartButton.addEventListener('click', async () => {
    const startUrl = urlInput.value.trim();
    try {
        new URL(startUrl);
        await beginScan(startUrl);
    } catch {
        alert('Будь ласка, введіть коректний URL (наприклад, https://example.com).');
    }
});

window.api.onSpiderResult((data) => {
    upsertScanResult(data);
});

window.api.onSpiderReferrersUpdate((allReferrers) => {
    applyReferrersUpdate(allReferrers);
});

window.api.onSpiderEnd((message) => {
    statusText.textContent = message;
    setUIState('idle');
    requestRefreshTable({ immediate: true });
    persistWorkspaceNow();
});

window.api.onSpiderProgress((progress) => {
    // Лише синхронізуємо паузу з бекенду; не відновлюємо running автоматично —
    // інакше завершення воркерів до обробки pause IPC повертає кнопку «Зупинити».
    if (progress.paused && uiState === 'running') {
        setUIState('paused');
    }
    updateUrlInputProgress(progress);
    if (uiState === 'paused') {
        statusText.textContent = 'На паузі';
    } else {
        statusText.textContent = progress.status || 'В процесі...';
    }
    statusScanned.textContent = `Проскановано: ${progress.scanned}`;
    const queueHtml = progress.queueHtml ?? 0;
    const queueMedia = progress.queueMedia ?? 0;
    if (queueHtml > 0 || queueMedia > 0) {
        statusQueue.textContent = `У черзі: ${progress.queue} (HTML: ${queueHtml}, медіа: ${queueMedia})`;
    } else {
        statusQueue.textContent = `У черзі: ${progress.queue ?? 0}`;
    }
    if (statusActive) {
        const active = progress.active ?? 0;
        const concurrency = progress.concurrency ?? 0;
        statusActive.textContent = concurrency > 0
            ? `Активних: ${active}/${concurrency}`
            : `Активних: ${active}`;
    }
    if (statusRate) {
        if (uiState === 'running' && !progress.paused && (progress.pagesPerSecond ?? 0) > 0) {
            statusRate.textContent = `Швидкість: ${progress.pagesPerSecond} стор./с`;
        } else if (uiState === 'paused') {
            statusRate.textContent = 'Швидкість: —';
        } else if (uiState === 'idle' && (progress.pagesPerSecond ?? 0) > 0) {
            statusRate.textContent = `Швидкість: ${progress.pagesPerSecond} стор./с`;
        } else {
            statusRate.textContent = 'Швидкість: —';
        }
    }
});

const DETAIL_PANEL_HEIGHT_KEY = 'detailPanelHeight';
const DEFAULT_DETAIL_PANEL_HEIGHT = 256;
const MIN_DETAIL_PANEL_HEIGHT = 120;
const MIN_RESULTS_PANEL_HEIGHT = 120;

function initDetailPanelResize() {
    const mainEl = document.querySelector('main');
    const handle = document.getElementById('panelResizeHandle');
    const panel = document.getElementById('detailPanel');
    if (!mainEl || !handle || !panel) {
        return;
    }

    function clampPanelHeight(height) {
        const mainHeight = mainEl.getBoundingClientRect().height;
        const maxHeight = Math.max(
            MIN_DETAIL_PANEL_HEIGHT,
            mainHeight - MIN_RESULTS_PANEL_HEIGHT - handle.offsetHeight - 12
        );
        return Math.min(maxHeight, Math.max(MIN_DETAIL_PANEL_HEIGHT, height));
    }

    function setPanelHeight(height) {
        panel.style.height = `${clampPanelHeight(height)}px`;
    }

    const savedHeight = parseInt(localStorage.getItem(DETAIL_PANEL_HEIGHT_KEY), 10);
    setPanelHeight(Number.isFinite(savedHeight) ? savedHeight : DEFAULT_DETAIL_PANEL_HEIGHT);

    handle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = panel.getBoundingClientRect().height;

        function onMouseMove(moveEvent) {
            setPanelHeight(startHeight + (startY - moveEvent.clientY));
        }

        function onMouseUp() {
            document.body.classList.remove('panel-resizing');
            localStorage.setItem(
                DETAIL_PANEL_HEIGHT_KEY,
                String(Math.round(panel.getBoundingClientRect().height))
            );
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.body.classList.add('panel-resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    handle.addEventListener('dblclick', () => {
        setPanelHeight(DEFAULT_DETAIL_PANEL_HEIGHT);
        localStorage.removeItem(DETAIL_PANEL_HEIGHT_KEY);
    });

    window.addEventListener('resize', () => {
        setPanelHeight(panel.getBoundingClientRect().height);
    });
}

initDetailPanelResize();
restoreWorkspaceFromSession();
rebuildContentTypeFilterOptions({ force: true });
setUIState('idle');

window.addEventListener('pagehide', () => {
    persistWorkspaceNow();
});
