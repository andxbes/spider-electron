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
        width: 800,
        height: 700,
        webPreferences: {
            // Шлях до preload-скрипта для безпечної взаємодії з renderer
            preload: path.join(__dirname, '../preload/preload.js'),
        },
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
let htmlQueue = [];
let mediaQueue = [];
let maxPagesToVisit = 0; // 0 = без ліміту
const robotsCache = new Map(); // host -> { parser, text }
const referrersMap = new Map();

function isPageLimitReached() {
    return maxPagesToVisit > 0 && visitedUrls.size >= maxPagesToVisit;
}

function tryClaimUrl(url) {
    if (visitedUrls.has(url)) {
        return false;
    }
    if (isPageLimitReached()) {
        return false;
    }
    visitedUrls.add(url);
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
        linkCount: 0,
        outlinks: [],
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

    const tokens = raw.toLowerCase().split(/[,\s]+/).filter(Boolean);
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
    return new URL(url).href.split('#')[0];
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

function enqueueUrl(url, referrer, allowedHostname) {
    try {
        const absoluteUrl = normalizePageUrl(url);
        if (!isSameHost(absoluteUrl, allowedHostname)) {
            return;
        }

        if (!referrersMap.has(absoluteUrl)) {
            referrersMap.set(absoluteUrl, new Set());
        }
        if (referrer !== 'N/A') {
            referrersMap.get(absoluteUrl).add(referrer);
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
            enqueueUrl(pageUrl, sitemapUrl, start.hostname);
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
        const referrers = referrersMap.has(url) ? Array.from(referrersMap.get(url)) : (referrer !== 'N/A' ? [referrer] : []);
        browserWindow.webContents.send('spider-result', buildResultWithIndexing(robots, robotsText, url, {
            status: 'SKIPPED',
            url: url,
            title: 'Заблоковано robots.txt',
            referrers: referrers,
        }));
        return;
    }

    try {
        const referrers = referrersMap.has(url) ? Array.from(referrersMap.get(url)) : (referrer !== 'N/A' ? [referrer] : []);

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
                referrers: previousUrl === null ? referrers : [previousUrl],
                redirectUrl: redirectUrl,
                responseTimeMs,
            }));

            if (!redirectUrl) {
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

            if (!referrersMap.has(currentUrl)) {
                referrersMap.set(currentUrl, new Set());
            }
            referrersMap.get(currentUrl).add(previousUrl);

            timed = await timedFetch(currentUrl);
            response = timed.response;
            responseTimeMs = timed.getElapsedMs();
        }

        if (isRedirectStatus(response.status)) {
            browserWindow.webContents.send('spider-result', buildResultWithIndexing(robots, robotsText, currentUrl, {
                status: response.status,
                url: currentUrl,
                title: '',
                referrers: previousUrl === null ? referrers : [previousUrl],
                redirectUrl: resolveRedirectTarget(currentUrl, response.headers.get('location')),
                responseTimeMs,
            }));
            return;
        }

        const contentType = getContentType(response);
        const pageReferrers = currentUrl === url
            ? referrers
            : (referrersMap.has(currentUrl) ? Array.from(referrersMap.get(currentUrl)) : [previousUrl].filter(Boolean));

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

        const title = $('title').text().trim();
        const description = $('meta[name="description"]').attr('content') || '';
        const canonical = $('link[rel="canonical"]').attr('href') || '';
        const outlinks = [];
        $('a').each((i, link) => {
            const href = $(link).attr('href');
            if (!href) {
                return;
            }
            try {
                const absoluteUrl = normalizePageUrl(new URL(href, currentUrl).href);
                outlinks.push({
                    href: absoluteUrl,
                    text: $(link).text().trim().slice(0, 200),
                });
            } catch (e) {
                // невалідний href
            }
        });

        const headings = [];
        $('h1, h2, h3, h4, h5, h6').each((i, el) => {
            headings.push({
                level: parseInt(el.tagName.substring(1)),
                text: $(el).text().trim()
            });
        });

        const metaRobotsRaw = $('meta[name="robots"]').attr('content')
            || $('meta[name="googlebot"]').attr('content')
            || getXRobotsTag(response)
            || '';
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
                linkCount: outlinks.length,
                outlinks: outlinks,
                headings: headings,
                responseTimeMs,
            },
            metaRobotsRaw
        ));

        if (metaRobotsParsed.blocksFollow) {
            console.log(`Знайдено nofollow на сторінці: ${currentUrl}`);
            return;
        }

        if (!isSessionPaused(session) && !session?.stopped) {
            for (const outlink of outlinks) {
                enqueueUrl(outlink.href, currentUrl, urlObject.hostname);
            }
        }
    } catch (error) {
        console.error(`Помилка під час сканування ${url}: ${error.message}`);
        const errorReferrers = referrersMap.has(url)
            ? Array.from(referrersMap.get(url))
            : (referrer !== 'N/A' ? [referrer] : []);
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

function completeScan(session, endMessage) {
    if (session.finished) {
        return;
    }
    session.finished = true;
    if (scanSession === session) {
        scanSession = null;
    }

    session.sendProgress();
    console.log(endMessage);

    const allReferrers = {};
    for (const [link, refs] of referrersMap.entries()) {
        allReferrers[link] = Array.from(refs);
    }
    session.browserWindow.webContents.send('spider-referrers-update', allReferrers);
    session.browserWindow.webContents.send('spider-end', endMessage);
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
