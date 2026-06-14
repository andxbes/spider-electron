const cheerio = require('cheerio');
const { MAX_CONCURRENCY } = require('./settings-persistence');
const {
    extractPageTitle,
    extractMetaDescription,
    collectMetaAttributeValues,
    extractMetaRobotsRaw,
    getXRobotsTag,
} = require('./page-extractors');
const {
    emitSpiderResult,
    extractPageViaHooks,
} = require('./crawl-hooks');
require('./crawl-defaults');
require('./plugins');
const {
    normalizePageUrl,
    isSameHost,
    isRedirectStatus,
    resolveRedirectTarget,
    getContentType,
    isHtmlContent,
} = require('../shared/url-utils');
const {
    classifyOutlinkKind,
    parseAnchorRel,
    formatOutlinkTag,
    isCrawlableLink,
    collectPageLinks,
} = require('./link-collector');
const {
    visitedUrls,
    isPageLimitReached,
    tryClaimUrl,
    clearCrawlRuntime,
    clearQueues,
    getScanSession,
    setScanSession,
    clearScanSession,
    setMaxPagesToVisit,
    getMaxPagesToVisit,
    getHtmlQueue,
    getMediaQueue,
} = require('./crawl-state');
const {
    buildSpiderResult,
    parseMetaRobotsDirective,
    buildResultWithIndexing,
    getRobotsTxtInfo,
} = require('./crawl-results');
const {
    addReferrer,
    referrerEntry,
    getReferrersListForUrl,
    getReferrersSnapshot,
    buildAllReferrersPayload,
    getReferrersMapKeys,
    clearReferrers,
    normalizeReferrerMeta,
    mergeReferrerMeta,
} = require('./crawl-referrers');
const {
    USER_AGENT,
    ROBOTS_UA,
    FETCH_TIMEOUT_MS,
    MAX_REDIRECT_HOPS,
    setFetchForTests,
    resetFetchForTests,
    fetchPage,
    timedFetch,
    getRobots,
    getRobotsTxtFieldsForUrl,
    sendRobotsBlockedResult,
    isInternalRobotsDisallowed,
} = require('./crawl-network');
const {
    FALLBACK_SITEMAP_PATHS,
    parseSitemapsFromRobotsTxt,
    fetchSitemapPageUrls,
    discoverSitemapUrls,
    seedQueueFromSitemaps,
} = require('./crawl-sitemap');
const {
    getQueueLength,
    hasPendingWork,
    dequeueNextUrl,
    enqueueUrl,
    enqueueProbeUrl,
    isUrlQueued,
    needsLinkProbe,
    isLikelyMediaUrl,
} = require('./crawl-queue');
const {
    probeDiscoveredLink,
    probeExternalLink,
    reportDiscoveredLinks,
    buildDiscoveredLinkResult,
    buildRobotsBlockedStub,
} = require('./probe');

async function buildReferrersEndPayload() {
    const referrers = buildAllReferrersPayload();
    const robotsByUrl = {};

    for (const url of getReferrersMapKeys()) {
        const fields = await getRobotsTxtFieldsForUrl(url);
        if (fields.robotsAllowed !== null || fields.robotsRule) {
            robotsByUrl[url] = fields;
        }
    }

    return { referrers, robotsByUrl };
}

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

    const session = getScanSession();
    console.log(`Сканую: ${url}`);

    const urlObject = new URL(url);
    const { parser: robots, text: robotsText } = await getRobots(urlObject);

    try {
        const referrers = getReferrersSnapshot(url, referrer);

        if (!robots.isAllowed(url, ROBOTS_UA)) {
            sendRobotsBlockedResult(browserWindow, robots, robotsText, url, referrers);
            return;
        }

        let currentUrl = url;
        let timed = await timedFetch(currentUrl);
        let response = timed.response;
        let responseTimeMs = timed.getElapsedMs();
        let previousUrl = null;
        let hop = 0;

        while (isRedirectStatus(response.status) && hop < MAX_REDIRECT_HOPS) {
            const redirectUrl = resolveRedirectTarget(currentUrl, response.headers.get('location'));

            emitSpiderResult(browserWindow, buildResultWithIndexing(robots, robotsText, currentUrl, {
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

            if (!robots.isAllowed(currentUrl, ROBOTS_UA)) {
                sendRobotsBlockedResult(
                    browserWindow,
                    robots,
                    robotsText,
                    currentUrl,
                    [referrerEntry(previousUrl)]
                );
                return;
            }

            timed = await timedFetch(currentUrl);
            response = timed.response;
            responseTimeMs = timed.getElapsedMs();
        }

        if (isRedirectStatus(response.status)) {
            emitSpiderResult(browserWindow, buildResultWithIndexing(robots, robotsText, currentUrl, {
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
            : (getReferrersListForUrl(currentUrl).length > 0
                ? getReferrersListForUrl(currentUrl)
                : (previousUrl ? [referrerEntry(previousUrl)] : []));

        if (!response.ok) {
            emitSpiderResult(browserWindow, buildResultWithIndexing(
                robots,
                robotsText,
                currentUrl,
                {
                    status: response.status,
                    url: currentUrl,
                    title: '',
                    referrers: pageReferrers,
                    contentType,
                    responseTimeMs,
                },
                getXRobotsTag(response) || null
            ));
            return;
        }

        if (!isHtmlContent(contentType)) {
            emitSpiderResult(browserWindow, buildResultWithIndexing(
                robots,
                robotsText,
                currentUrl,
                {
                    status: response.status,
                    url: currentUrl,
                    title: '',
                    referrers: pageReferrers,
                    contentType,
                    responseTimeMs,
                },
                getXRobotsTag(response) || null
            ));
            return;
        }

        const html = await response.text();
        responseTimeMs = timed.getElapsedMs();
        const $ = cheerio.load(html);

        const pageFields = extractPageViaHooks({
            $,
            response,
            url: currentUrl,
            hostname: urlObject.hostname,
            robots,
            robotsText,
        });
        const {
            metaRobotsRaw = '',
            title = '',
            metaDescription = '',
            metaCanonical = '',
            headings = [],
            ...pluginPageFields
        } = pageFields;
        const metaRobotsParsed = parseMetaRobotsDirective(metaRobotsRaw);

        emitSpiderResult(browserWindow, buildResultWithIndexing(
            robots,
            robotsText,
            currentUrl,
            {
                status: response.status,
                url: currentUrl,
                title: title || '',
                referrers: pageReferrers,
                metaDescription: metaDescription || '',
                metaCanonical: metaCanonical || '',
                contentType: contentType || 'text/html',
                external: false,
                fetched: true,
                headings: headings || [],
                responseTimeMs,
                ...pluginPageFields,
            },
            metaRobotsRaw
        ));

        if (!isSessionPaused(session) && !session?.stopped) {
            const pageLinks = collectPageLinks($, currentUrl, urlObject.hostname);
            await reportDiscoveredLinks(
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
        emitSpiderResult(browserWindow, buildResultWithIndexing(
            robots,
            robotsText,
            url,
            {
                status: 'ERROR',
                url: url,
                title: '',
                referrers: errorReferrers,
            }
        ));
    }
}

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
    if (getScanSession() === session) {
        clearScanSession();
    }

    console.log(endMessage);

    session.browserWindow.webContents.send('spider-end', endMessage);
    void buildReferrersEndPayload().then((payload) => {
        session.browserWindow.webContents.send('spider-referrers-update', payload);
    });
}

async function startSpider(startUrl, options, browserWindow) {
    const existingSession = getScanSession();
    if (existingSession && !existingSession.finished) {
        existingSession.stopped = true;
    }

    const useSitemap = options?.useSitemap ?? false;
    setMaxPagesToVisit(Math.max(0, parseInt(options?.maxPages, 10) || 0));
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
                queueHtml: getHtmlQueue().length,
                queueMedia: getMediaQueue().length,
                active: this.activeWorkers,
                concurrency: this.concurrency,
                paused: this.paused,
                pagesPerSecond: Math.round(this.getPagesPerSecond() * 10) / 10,
                status: progressStatus,
            });
        },
        tryFinishOrPump() {
            if (this.finished || getScanSession() !== this) {
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
            const canStartMore = hasPendingWork() && this.activeWorkers < this.concurrency;

            if (canStartMore) {
                this.pumpQueue();
                return;
            }

            if (this.activeWorkers === 0 && !hasPendingWork()) {
                let endMessage = 'Сканування завершено!';
                const remaining = getQueueLength();
                if (limitReached && remaining > 0) {
                    endMessage = `Досягнуто ліміт ${getMaxPagesToVisit()} стор. У черзі залишилось: ${remaining}`;
                }
                completeScan(this, endMessage);
            }
        },
        pumpQueue() {
            if (this.finished || getScanSession() !== this || this.paused || this.stopped) {
                return;
            }

            while (
                !this.finished &&
                !this.paused &&
                !this.stopped &&
                this.activeWorkers < this.concurrency &&
                hasPendingWork()
            ) {
                const item = dequeueNextUrl();
                if (!item) {
                    break;
                }

                this.activeWorkers++;
                this.markScanStarted();
                const work = item.type === 'probe'
                    ? probeDiscoveredLink(item.url, item.referrer, item.link, this.browserWindow)
                    : crawl(item.url, item.referrer, this.browserWindow);
                work
                    .catch((err) => {
                        console.error(`Помилка воркера для ${item.url}:`, err);
                    })
                    .finally(() => {
                        if (getScanSession() !== this) {
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

    setScanSession(session);

    clearCrawlRuntime();
    clearReferrers();

    if (useSitemap) {
        const sitemapPageCount = await seedQueueFromSitemaps(startUrl, browserWindow, getRobots);
        if (getScanSession() !== session) {
            return;
        }
        session.sendProgress(
            sitemapPageCount > 0
                ? `З sitemap додано в чергу: ${sitemapPageCount}`
                : 'Sitemap не знайдено, обхід за посиланнями'
        );
    }

    if (getScanSession() !== session) {
        return;
    }

    enqueueUrl(startUrl, 'N/A', new URL(startUrl).hostname);
    session.pumpQueue();
}

function resetSpiderStateForTests() {
    clearCrawlRuntime();
    clearReferrers();
    setMaxPagesToVisit(0);
    clearScanSession();
}

module.exports = {
    USER_AGENT,
    ROBOTS_UA,
    FETCH_TIMEOUT_MS,
    MAX_REDIRECT_HOPS,
    FALLBACK_SITEMAP_PATHS,
    resetSpiderStateForTests,
    setFetchForTests,
    resetFetchForTests,
    tryClaimUrl,
    fetchPage,
    timedFetch,
    extractPageTitle,
    extractMetaDescription,
    extractElementText: require('./page-extractors').extractElementText,
    collectPageLinks,
    parseMetaRobotsDirective,
    parseAnchorRel,
    classifyOutlinkKind,
    formatOutlinkTag,
    isCrawlableLink,
    buildSpiderResult,
    buildResultWithIndexing,
    getRobotsTxtInfo,
    getRobotsTxtFieldsForUrl,
    normalizeReferrerMeta,
    mergeReferrerMeta,
    addReferrer,
    getReferrersListForUrl,
    getReferrersSnapshot,
    buildAllReferrersPayload,
    enqueueUrl,
    dequeueNextUrl,
    getQueueLength,
    hasPendingWork,
    isUrlQueued,
    clearQueues,
    enqueueProbeUrl,
    probeDiscoveredLink,
    probeExternalLink,
    needsLinkProbe,
    isInternalRobotsDisallowed,
    buildRobotsBlockedStub,
    isPageLimitReached,
    parseSitemapsFromRobotsTxt,
    discoverSitemapUrls,
    fetchSitemapPageUrls,
    seedQueueFromSitemaps,
    getRobots,
    crawl,
    startSpider,
    getScanSession,
    clearScanSession,
    isLikelyMediaUrl,
    isHtmlContent,
    collectMetaAttributeValues,
    extractMetaRobotsRaw,
    getXRobotsTag,
    crawlHookRegistry: require('./crawl-hooks').crawlHookRegistry,
    CRAWL_HOOKS: require('./crawl-hooks').CRAWL_HOOKS,
    emitSpiderResult,
    extractPageViaHooks,
    reportDiscoveredLinks,
    buildDiscoveredLinkResult,
};
