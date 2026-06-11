const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { URL } = require('node:url');
const { fetch: undiciFetch } = require('undici');
const cheerio = require('cheerio');

const robotsParser = require('robots-parser');
const { getSettingsPath, loadSettings, saveSettings, MAX_CONCURRENCY } = require('./settings-persistence');
const { registerSessionDumpHandlers, createApplicationMenu } = require('./session-dump');

let mainWindow = null;

// Функція створення головного вікна застосунку
const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        backgroundColor: '#f4f4f5',
        webPreferences: {
            // Шлях до preload-скрипта для безпечної взаємодії з renderer
            preload: path.join(__dirname, '../preload/preload.js'),
        },
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Завантажуємо основний HTML-файл
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Розкоментуйте для відкриття інструментів розробника при старті
    // mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
    registerSessionDumpHandlers(ipcMain);
    createApplicationMenu(() => mainWindow);
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});


// --- ЛОГІКА ВЕБ-ПАВУКА ---

const USER_AGENT = 'MyElectronSpider/1.0 (+https://github.com/your-repo)';
const ROBOTS_UA = 'MyElectronSpider/1.0';
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECT_HOPS = 10;
const FALLBACK_SITEMAP_PATHS = ['/sitemap_index.xml', '/sitemap.xml', '/index.xml'];

const MEDIA_URL_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff',
    'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv',
    'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a',
    'pdf', 'zip', 'gz', 'rar', '7z', 'tar',
    'css', 'js', 'mjs', 'map',
    'woff', 'woff2', 'ttf', 'eot', 'otf',
    'xml', 'json', 'txt', 'csv',
]);

const visitedUrls = new Set();
const reportedStubUrls = new Set();
let htmlQueue = [];
let mediaQueue = [];
let maxPagesToVisit = 0; // 0 = без ліміту
const robotsCache = new Map(); // host -> { parser, text }
const referrersMap = new Map();

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

function fetchPage(url) {
    // undici (Node fetch), а не global fetch Electron — інакше redirect: 'manual'
    // повертає opaque-redirect зі status 0 без Location, і 301/302 губляться.
    return undiciFetch(url, {
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

const EXTRACT_TEXT_REMOVE_SELECTOR = 'script, style, svg, noscript, template, iframe, [aria-hidden="true"]';

function normalizeExtractedText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractElementText($, el) {
    const clone = $(el).clone();
    clone.find(EXTRACT_TEXT_REMOVE_SELECTOR).remove();
    return normalizeExtractedText(clone.text());
}

function collectMetaAttributeValues($, selector) {
    const values = [];
    const seen = new Set();
    $(selector).each((_, el) => {
        const value = ($(el).attr('content') || '').trim();
        if (!value) {
            return;
        }
        const key = value.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        values.push(value);
    });
    return values;
}

function extractPageTitle($) {
    let titleEl = $('head > title').first();
    if (!titleEl.length) {
        // $('title').text() зливає ВСІ <title> на сторінці — беремо лише перший.
        titleEl = $('title').first();
    }
    let title = titleEl.length ? extractElementText($, titleEl.get(0)) : '';
    if (!title) {
        title = ($('head meta[property="og:title"]').attr('content')
            || $('meta[property="og:title"]').attr('content')
            || $('meta[name="twitter:title"]').attr('content')
            || '').trim();
    }
    return title;
}

function extractMetaDescription($) {
    const values = collectMetaAttributeValues($, 'head meta[name="description"]');
    if (!values.length) {
        return collectMetaAttributeValues($, 'meta[name="description"]').join('; ');
    }
    return values.join('; ');
}

function firstSrcsetUrl(srcset) {
    const first = String(srcset || '').split(',')[0]?.trim().split(/\s+/)[0];
    return first || '';
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

const OUTLINK_IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff',
]);
const OUTLINK_MEDIA_EXTENSIONS = new Set([
    'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv', 'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a',
]);
const OUTLINK_FONT_EXTENSIONS = new Set(['woff', 'woff2', 'ttf', 'eot', 'otf']);
const OUTLINK_PLUGIN_EXTENSIONS = new Set(['swf', 'flv']);
const OUTLINK_HTML_EXTENSIONS = new Set(['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'shtml']);

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

function extractMetaRobotsRaw($, response) {
    let values = collectMetaAttributeValues($, 'head meta[name="robots"], head meta[name="googlebot"]');
    if (!values.length) {
        values = collectMetaAttributeValues($, 'meta[name="robots"], meta[name="googlebot"]');
    }
    const xRobots = getXRobotsTag(response).trim();
    if (xRobots && !values.some((value) => value.toLowerCase() === xRobots.toLowerCase())) {
        values.push(xRobots);
    }
    return values.join('; ');
}

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

function getXRobotsTag(response) {
    return response.headers.get('x-robots-tag') || '';
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

function normalizePageUrl(url) {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
}

function mergeReferrerText(targetMap, referrerUrl, linkText = '') {
    const text = String(linkText || '').trim().slice(0, 200);
    if (!targetMap.has(referrerUrl)) {
        targetMap.set(referrerUrl, text);
        return;
    }
    const existing = targetMap.get(referrerUrl) || '';
    if (!text || existing === text) {
        return;
    }
    if (!existing) {
        targetMap.set(referrerUrl, text);
        return;
    }
    if (!existing.includes(text)) {
        targetMap.set(referrerUrl, `${existing}; ${text}`.slice(0, 200));
    }
}

function addReferrer(targetUrl, referrerUrl, linkText = '') {
    if (!referrersMap.has(targetUrl)) {
        referrersMap.set(targetUrl, new Map());
    }
    try {
        mergeReferrerText(referrersMap.get(targetUrl), normalizePageUrl(referrerUrl), linkText);
    } catch {
        mergeReferrerText(referrersMap.get(targetUrl), referrerUrl, linkText);
    }
}

function referrerEntry(href, text = '') {
    return { href, text: text || '' };
}

function getReferrersListForUrl(url) {
    const refs = referrersMap.get(url);
    if (!refs) {
        return [];
    }
    return Array.from(refs.entries()).map(([href, text]) => referrerEntry(href, text));
}

function getReferrersSnapshot(url, fallbackReferrer = null) {
    if (referrersMap.has(url)) {
        return getReferrersListForUrl(url);
    }
    if (fallbackReferrer && fallbackReferrer !== 'N/A') {
        return [referrerEntry(fallbackReferrer)];
    }
    return [];
}

function buildAllReferrersPayload() {
    const payload = {};
    for (const [link, refs] of referrersMap.entries()) {
        payload[link] = Array.from(refs.entries()).map(([href, text]) => referrerEntry(href, text));
    }
    return payload;
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

function isLikelyMediaUrl(url) {
    return MEDIA_URL_EXTENSIONS.has(getUrlExtension(url));
}

function getQueueLength() {
    return htmlQueue.length + mediaQueue.length;
}

function isUrlQueued(url) {
    return htmlQueue.some((item) => item.url === url) || mediaQueue.some((item) => item.url === url);
}

function clearQueues() {
    htmlQueue = [];
    mediaQueue = [];
}

function dequeueNextUrl() {
    if (htmlQueue.length > 0) {
        return htmlQueue.shift();
    }
    if (mediaQueue.length > 0) {
        return mediaQueue.shift();
    }
    return null;
}

function isSameHost(url, hostname) {
    return new URL(url).hostname === hostname;
}

function parseSitemapsFromRobotsTxt(text) {
    const sitemaps = [];
    for (const line of text.split('\n')) {
        const match = line.match(/^\s*Sitemap:\s*(\S+)/i);
        if (match) {
            sitemaps.push(match[1].trim());
        }
    }
    return sitemaps;
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
    } catch (e) {
        // robots.txt відсутній — вважаємо все дозволеним
    }

    const entry = {
        parser: robotsParser(robotsUrl, text),
        text,
    };
    robotsCache.set(host, entry);
    return entry;
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

function buildDiscoveredLinkResult(link) {
    return buildSpiderResult({
        url: link.url,
        status: '',
        title: link.text || '',
        text: link.text || '',
        external: Boolean(link.external),
        fetched: false,
        kind: link.kind || '',
        tag: link.tag || '',
        rel: link.rel || '',
        relFollowAllowed: link.relFollowAllowed,
        relIndexAllowed: link.relIndexAllowed,
        relLabel: link.relLabel || '',
        referrers: getReferrersListForUrl(link.url),
    });
}

function reportDiscoveredLinks(browserWindow, links, sourceUrl, allowedHostname, { follow = true } = {}) {
    const stubs = [];

    for (const link of links) {
        if (follow && !link.external && isCrawlableLink(link)) {
            enqueueUrl(link.url, sourceUrl, allowedHostname, link.text);
            continue;
        }

        addReferrer(link.url, sourceUrl, link.text);

        if (reportedStubUrls.has(link.url)) {
            continue;
        }

        const crawlableInternal = follow && !link.external && isCrawlableLink(link);
        if (crawlableInternal && (visitedUrls.has(link.url) || isUrlQueued(link.url))) {
            continue;
        }

        reportedStubUrls.add(link.url);
        stubs.push(buildDiscoveredLinkResult(link));
    }

    if (stubs.length > 0) {
        browserWindow.webContents.send('spider-results-batch', stubs);
    }
}

function enqueueUrl(url, referrer, allowedHostname, linkText = '') {
    try {
        const absoluteUrl = normalizePageUrl(url);
        if (!isSameHost(absoluteUrl, allowedHostname)) {
            return;
        }

        if (referrer !== 'N/A') {
            addReferrer(absoluteUrl, referrer, linkText);
        }

        if (!visitedUrls.has(absoluteUrl) && !isUrlQueued(absoluteUrl)) {
            const targetQueue = isLikelyMediaUrl(absoluteUrl) ? mediaQueue : htmlQueue;
            targetQueue.push({ url: absoluteUrl, referrer });
        }
    } catch (e) {
        // невалідний URL
    }
}

async function fetchSitemapPageUrls(sitemapUrl, allowedHostname, fetchedSitemaps) {
    if (fetchedSitemaps.has(sitemapUrl)) {
        return [];
    }
    fetchedSitemaps.add(sitemapUrl);

    try {
        const response = await fetchPage(sitemapUrl);
        if (!response.ok) {
            console.log(`Sitemap недоступний (${response.status}): ${sitemapUrl}`);
            return [];
        }

        const xml = await response.text();
        const $ = cheerio.load(xml, { xmlMode: true });
        const pageUrls = [];
        const isSitemapIndex = $('sitemapindex').length > 0 || /<sitemapindex[\s>]/i.test(xml);

        if (isSitemapIndex) {
            const nestedSitemaps = [];
            $('sitemap loc, sitemap > loc').each((_, el) => {
                const loc = $(el).text().trim();
                if (loc) {
                    nestedSitemaps.push(loc);
                }
            });

            for (const nestedUrl of nestedSitemaps) {
                const nestedPages = await fetchSitemapPageUrls(nestedUrl, allowedHostname, fetchedSitemaps);
                pageUrls.push(...nestedPages);
            }
            return pageUrls;
        }

        const collectPageUrl = (loc) => {
            if (!loc) {
                return;
            }
            try {
                const absoluteUrl = normalizePageUrl(loc);
                if (isSameHost(absoluteUrl, allowedHostname)) {
                    pageUrls.push(absoluteUrl);
                }
            } catch (e) {
                // пропускаємо невалідні URL
            }
        };

        $('url loc, url > loc').each((_, el) => collectPageUrl($(el).text().trim()));

        if (pageUrls.length === 0) {
            $('loc').each((_, el) => collectPageUrl($(el).text().trim()));
        }

        return pageUrls;
    } catch (error) {
        console.error(`Помилка читання sitemap ${sitemapUrl}: ${error.message}`);
        return [];
    }
}

async function discoverSitemapUrls(startUrl) {
    const start = new URL(startUrl);
    const origin = `${start.protocol}//${start.host}`;
    const { text } = await getRobots(start);

    const sitemapUrls = parseSitemapsFromRobotsTxt(text);
    if (sitemapUrls.length === 0) {
        for (const path of FALLBACK_SITEMAP_PATHS) {
            sitemapUrls.push(new URL(path, origin).href);
        }
    }

    return [...new Set(sitemapUrls)];
}

async function seedQueueFromSitemaps(startUrl, browserWindow) {
    const start = new URL(startUrl);
    const sitemapUrls = await discoverSitemapUrls(startUrl);
    const fetchedSitemaps = new Set();
    const pageUrls = new Set();

    browserWindow.webContents.send('spider-progress', {
        scanned: 0,
        queue: 0,
        status: `Пошук sitemap (${sitemapUrls.length})...`,
    });

    for (const sitemapUrl of sitemapUrls) {
        const urls = await fetchSitemapPageUrls(sitemapUrl, start.hostname, fetchedSitemaps);
        for (const pageUrl of urls) {
            pageUrls.add(pageUrl);
            enqueueUrl(pageUrl, sitemapUrl, start.hostname, 'sitemap');
        }
    }

    console.log(`У sitemap знайдено сторінок: ${pageUrls.size}`);
    return pageUrls.size;
}

/**
 * Основна функція сканування однієї сторінки
 * @param {string} url - URL для сканування
 * @param {string} referrer - URL, з якого перейшли на цю сторінку
 * @param {BrowserWindow} browserWindow - Вікно для надсилання результатів
 */
function isSessionActive(session) {
    return session && !session.finished && !session.stopped;
}

function isSessionPaused(session) {
    return isSessionActive(session) && session.paused;
}

async function crawl(url, referrer, browserWindow) {
    if (!tryClaimUrl(url)) {
        return;
    }

    const session = scanSession;
    console.log(`Сканую: ${url}`);

    const urlObject = new URL(url);
    const { parser: robots, text: robotsText } = await getRobots(urlObject);

    if (!robots.isAllowed(url, ROBOTS_UA)) {
        console.log(`Заблоковано robots.txt: ${url}`);
        const referrers = getReferrersSnapshot(url, referrer);
        browserWindow.webContents.send('spider-result', buildResultWithIndexing(robots, robotsText, url, {
            status: 'SKIPPED',
            url: url,
            title: 'Заблоковано robots.txt',
            referrers: referrers,
        }));
        return;
    }

    try {
        const referrers = getReferrersSnapshot(url, referrer);

        let currentUrl = url;
        let timed = await timedFetch(currentUrl);
        let response = timed.response;
        let responseTimeMs = timed.getElapsedMs();
        let previousUrl = null;
        let hop = 0;

        while (isRedirectStatus(response.status) && hop < MAX_REDIRECT_HOPS) {
            const redirectUrl = resolveRedirectTarget(currentUrl, response.headers.get('location'));

            browserWindow.webContents.send('spider-result', buildResultWithIndexing(robots, robotsText, currentUrl, {
                status: response.status,
                url: currentUrl,
                title: '',
                referrers: previousUrl === null ? referrers : [referrerEntry(previousUrl)],
                redirectUrl: redirectUrl,
                responseTimeMs,
            }));

            if (!redirectUrl) {
                return;
            }

            if (redirectUrl === currentUrl) {
                return;
            }

            if (isSessionPaused(session)) {
                return;
            }

            try {
                if (!isSameHost(redirectUrl, urlObject.hostname)) {
                    return;
                }
            } catch {
                return;
            }

            previousUrl = currentUrl;
            currentUrl = redirectUrl;
            hop++;

            if (visitedUrls.has(currentUrl)) {
                return;
            }
            visitedUrls.add(currentUrl);

            addReferrer(currentUrl, previousUrl);

            timed = await timedFetch(currentUrl);
            response = timed.response;
            responseTimeMs = timed.getElapsedMs();
        }

        if (isRedirectStatus(response.status)) {
            browserWindow.webContents.send('spider-result', buildResultWithIndexing(robots, robotsText, currentUrl, {
                status: response.status,
                url: currentUrl,
                title: '',
                referrers: previousUrl === null ? referrers : [referrerEntry(previousUrl)],
                redirectUrl: resolveRedirectTarget(currentUrl, response.headers.get('location')),
                responseTimeMs,
            }));
            return;
        }

        const contentType = getContentType(response);
        const pageReferrers = currentUrl === url
            ? referrers
            : (referrersMap.has(currentUrl)
                ? getReferrersListForUrl(currentUrl)
                : (previousUrl ? [referrerEntry(previousUrl)] : []));

        if (!response.ok) {
            browserWindow.webContents.send('spider-result', buildResultWithIndexing(
                robots,
                robotsText,
                currentUrl,
                {
                    status: response.status,
                    url: currentUrl,
                    title: `HTTP ${response.status}`,
                    referrers: pageReferrers,
                    contentType,
                    responseTimeMs,
                },
                getXRobotsTag(response) || null
            ));
            return;
        }

        if (!isHtmlContent(contentType)) {
            browserWindow.webContents.send('spider-result', buildResultWithIndexing(robots, robotsText, currentUrl, {
                status: response.status,
                url: currentUrl,
                title: contentType || 'Медіа / не-HTML',
                referrers: pageReferrers,
                contentType,
                responseTimeMs,
            }));
            return;
        }

        const html = await response.text();
        responseTimeMs = timed.getElapsedMs();
        const $ = cheerio.load(html);

        const title = extractPageTitle($);
        const description = extractMetaDescription($);
        const canonical = $('link[rel="canonical"]').attr('href') || '';
        const pageLinks = collectPageLinks($, currentUrl, urlObject.hostname);

        const headings = [];
        $('h1, h2, h3, h4, h5, h6').each((i, el) => {
            const text = extractElementText($, el);
            if (!text) {
                return;
            }
            headings.push({
                level: parseInt(el.tagName.substring(1)),
                text,
            });
        });

        const metaRobotsRaw = extractMetaRobotsRaw($, response);
        const metaRobotsParsed = parseMetaRobotsDirective(metaRobotsRaw);

        browserWindow.webContents.send('spider-result', buildResultWithIndexing(
            robots,
            robotsText,
            currentUrl,
            {
                status: response.status,
                url: currentUrl,
                title: title || 'Без заголовка',
                referrers: pageReferrers,
                metaDescription: description,
                metaCanonical: canonical,
                contentType: contentType || 'text/html',
                external: false,
                fetched: true,
                headings: headings,
                responseTimeMs,
            },
            metaRobotsRaw
        ));

        if (!isSessionPaused(session) && !session?.stopped) {
            reportDiscoveredLinks(
                browserWindow,
                pageLinks,
                currentUrl,
                urlObject.hostname,
                { follow: !metaRobotsParsed.blocksFollow }
            );
            if (metaRobotsParsed.blocksFollow) {
                console.log(`Знайдено nofollow на сторінці: ${currentUrl}`);
            }
        }
    } catch (error) {
        console.error(`Помилка під час сканування ${url}: ${error.message}`);
        const errorReferrers = getReferrersSnapshot(url, referrer);
        browserWindow.webContents.send('spider-result', buildResultWithIndexing(
            robots,
            robotsText,
            url,
            {
                status: 'ERROR',
                url: url,
                title: error.message || 'Помилка мережі',
                referrers: errorReferrers,
            }
        ));
    }
}

let scanSession = null;

function sendFinalProgress(session, endMessage) {
    session.browserWindow.webContents.send('spider-progress', {
        scanned: visitedUrls.size,
        queue: 0,
        queueHtml: 0,
        queueMedia: 0,
        active: 0,
        concurrency: session.concurrency,
        paused: false,
        pagesPerSecond: Math.round(session.getPagesPerSecond() * 10) / 10,
        status: endMessage,
        finished: true,
    });
}

function completeScan(session, endMessage) {
    if (session.finished) {
        return;
    }
    sendFinalProgress(session, endMessage);
    session.finished = true;
    if (scanSession === session) {
        scanSession = null;
    }

    console.log(endMessage);

    session.browserWindow.webContents.send('spider-end', endMessage);
    session.browserWindow.webContents.send('spider-referrers-update', buildAllReferrersPayload());
}

async function startSpider(startUrl, options, browserWindow) {
    if (scanSession && !scanSession.finished) {
        scanSession.stopped = true;
    }

    const useSitemap = options?.useSitemap ?? false;
    maxPagesToVisit = Math.max(0, parseInt(options?.maxPages, 10) || 0);
    const concurrency = Math.min(
        MAX_CONCURRENCY,
        Math.max(1, parseInt(options?.concurrency, 10) || 1)
    );

    const session = {
        browserWindow,
        concurrency,
        paused: false,
        stopped: false,
        finished: false,
        activeWorkers: 0,
        scanStartMs: null,
        pausedAtMs: null,
        totalPausedMs: 0,
        pagesCompleted: 0,
        markScanStarted() {
            if (this.scanStartMs === null) {
                this.scanStartMs = Date.now();
            }
        },
        markPaused() {
            if (this.pausedAtMs === null) {
                this.pausedAtMs = Date.now();
            }
        },
        markResumed() {
            if (this.pausedAtMs !== null) {
                this.totalPausedMs += Date.now() - this.pausedAtMs;
                this.pausedAtMs = null;
            }
        },
        getActiveElapsedMs() {
            if (this.scanStartMs === null) {
                return 0;
            }
            let elapsed = Date.now() - this.scanStartMs - this.totalPausedMs;
            if (this.paused && this.pausedAtMs !== null) {
                elapsed -= Date.now() - this.pausedAtMs;
            }
            return Math.max(0, elapsed);
        },
        getPagesPerSecond() {
            const elapsedMs = this.getActiveElapsedMs();
            if (elapsedMs <= 0 || this.pagesCompleted === 0) {
                return 0;
            }
            return this.pagesCompleted / (elapsedMs / 1000);
        },
        sendProgress(status) {
            if (this.finished) {
                return;
            }
            let progressStatus = status;
            if (!progressStatus) {
                if (this.paused) {
                    progressStatus = 'На паузі';
                } else if (this.stopped) {
                    progressStatus = 'Зупинка...';
                } else {
                    progressStatus = 'В процесі...';
                }
            }
            this.browserWindow.webContents.send('spider-progress', {
                scanned: visitedUrls.size,
                queue: getQueueLength(),
                queueHtml: htmlQueue.length,
                queueMedia: mediaQueue.length,
                active: this.activeWorkers,
                concurrency: this.concurrency,
                paused: this.paused,
                pagesPerSecond: Math.round(this.getPagesPerSecond() * 10) / 10,
                status: progressStatus,
            });
        },
        tryFinishOrPump() {
            if (this.finished || scanSession !== this) {
                return;
            }

            if (this.stopped && this.activeWorkers === 0) {
                const remaining = getQueueLength();
                const msg = remaining > 0
                    ? `Сканування зупинено. У черзі залишилось: ${remaining}`
                    : 'Сканування зупинено.';
                completeScan(this, msg);
                return;
            }

            if (this.paused) {
                if (this.activeWorkers === 0) {
                    this.sendProgress('На паузі');
                }
                return;
            }

            const limitReached = isPageLimitReached();
            const canStartMore = !limitReached && getQueueLength() > 0 && this.activeWorkers < this.concurrency;

            if (canStartMore) {
                this.pumpQueue();
                return;
            }

            if (this.activeWorkers === 0 && (getQueueLength() === 0 || limitReached)) {
                let endMessage = 'Сканування завершено!';
                const remaining = getQueueLength();
                if (limitReached && remaining > 0) {
                    endMessage = `Досягнуто ліміт ${maxPagesToVisit} стор. У черзі залишилось: ${remaining}`;
                }
                completeScan(this, endMessage);
            }
        },
        pumpQueue() {
            if (this.finished || scanSession !== this || this.paused || this.stopped) {
                return;
            }

            while (
                !this.finished &&
                !this.paused &&
                !this.stopped &&
                this.activeWorkers < this.concurrency &&
                getQueueLength() > 0 &&
                !isPageLimitReached()
            ) {
                const item = dequeueNextUrl();
                if (!item) {
                    break;
                }

                this.activeWorkers++;
                this.markScanStarted();
                crawl(item.url, item.referrer, this.browserWindow)
                    .catch((err) => {
                        console.error(`Помилка воркера для ${item.url}:`, err);
                    })
                    .finally(() => {
                        if (scanSession !== this) {
                            return;
                        }
                        this.activeWorkers--;
                        this.pagesCompleted++;
                        this.tryFinishOrPump();
                        this.sendProgress();
                    });
            }

            this.tryFinishOrPump();
        },
    };

    scanSession = session;

    visitedUrls.clear();
    reportedStubUrls.clear();
    clearQueues();
    referrersMap.clear();
    robotsCache.clear();

    if (useSitemap) {
        const sitemapPageCount = await seedQueueFromSitemaps(startUrl, browserWindow);
        if (scanSession !== session) {
            return;
        }
        session.sendProgress(
            sitemapPageCount > 0
                ? `З sitemap додано в чергу: ${sitemapPageCount}`
                : 'Sitemap не знайдено, обхід за посиланнями'
        );
    }

    if (scanSession !== session) {
        return;
    }

    enqueueUrl(startUrl, 'N/A', new URL(startUrl).hostname);
    session.pumpQueue();
}

ipcMain.handle('settings:get', async () => {
    const settings = await loadSettings();
    return { settings, filePath: getSettingsPath() };
});

ipcMain.handle('settings:save', async (_event, settings) => {
    const saved = await saveSettings(settings);
    return { settings: saved, filePath: getSettingsPath() };
});

ipcMain.on('start-spider', (event, payload) => {
    const startUrl = typeof payload === 'string' ? payload : payload.startUrl;
    const options = typeof payload === 'string' ? {} : (payload.options || {});
    console.log(`Отримано запит на сканування, починаючи з: ${startUrl}`, options);
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (browserWindow) {
        startSpider(startUrl, options, browserWindow).catch(err => {
            console.error('Критична помилка в startSpider:', err);
            browserWindow.webContents.send('spider-end', `Помилка: ${err.message}`);
            scanSession = null;
        });
    }
});

ipcMain.handle('spider-pause', () => {
    if (scanSession && !scanSession.finished && !scanSession.stopped) {
        scanSession.paused = true;
        scanSession.markPaused();
        scanSession.sendProgress('На паузі');
        return { ok: true };
    }
    return { ok: false };
});

ipcMain.handle('spider-resume', () => {
    if (scanSession && !scanSession.finished && !scanSession.stopped && scanSession.paused) {
        scanSession.paused = false;
        scanSession.markResumed();
        scanSession.sendProgress('В процесі...');
        scanSession.pumpQueue();
        return { ok: true };
    }
    return { ok: false };
});

ipcMain.on('spider-stop', () => {
    if (scanSession && !scanSession.finished) {
        scanSession.stopped = true;
        scanSession.paused = false;
        scanSession.sendProgress('Зупинка...');
        scanSession.tryFinishOrPump();
    }
});

ipcMain.handle('shell:open-external', async (_event, url) => {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { ok: false };
        }
        await shell.openExternal(url);
        return { ok: true };
    } catch {
        return { ok: false };
    }
});
