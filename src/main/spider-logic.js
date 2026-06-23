const { MAX_CONCURRENCY } = require('./settings-persistence');
const { parseHtmlDocumentAsync, terminateHtmlParsePool } = require('./html-parse-pool');
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
    createRedirectChainTracker,
    MAX_REDIRECT_HOPS,
    redirectHopOnlyFields,
} = require('../shared/redirect-chain');
const {
    classifyOutlinkKind,
    parseAnchorRel,
    formatOutlinkTag,
    isCrawlableLink,
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
    setRespectRobotsTxt,
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
    DEFAULT_USER_AGENT,
    FETCH_TIMEOUT_MS,
    setFetchForTests,
    resetFetchForTests,
    setScanAuthContext,
    clearScanAuthContext,
    setScanUserAgent,
    clearScanUserAgent,
    setScanRequestDelayMs,
    clearScanRequestDelayMs,
    fetchPage,
    timedFetch,
    getRobots,
    getRobotsTxtFieldsForUrl,
    sendRobotsBlockedResult,
    isInternalRobotsDisallowed,
    shouldBlockByRobotsTxt,
} = require('./crawl-network');
const { normalizeAuthSettings } = require('./http-auth');
const { resolveUserAgent } = require('../shared/user-agents');
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

function shouldAbortCrawl(session) {
    if (!session) {
        return false;
    }
    return !isSessionActive(session);
}

function stopSpiderSession() {
    const session = getScanSession();
    if (!session || session.finished) {
        return false;
    }
    session.stopped = true;
    session.paused = false;
    void terminateHtmlParsePool();
    session.sendProgress('Зупинка...');
    session.tryFinishOrPump();
    return true;
}

async function crawl(url, referrer, browserWindow) {
    if (!tryClaimUrl(url)) {
        return;
    }

    const session = getScanSession();
    console.log(`Сканую: ${url}`);

    const urlObject = new URL(url);
    const { parser: robots, text: robotsText } = await getRobots(urlObject);
    if (shouldAbortCrawl(session)) {
        return;
    }

    try {
        const referrers = getReferrersSnapshot(url, referrer);

        if (shouldBlockByRobotsTxt(robots, url)) {
            if (!shouldAbortCrawl(session)) {
                sendRobotsBlockedResult(browserWindow, robots, robotsText, url, referrers);
            }
            return;
        }

        let currentUrl = url;
        let timed = await timedFetch(currentUrl);
        if (shouldAbortCrawl(session)) {
            return;
        }
        let response = timed.response;
        let responseTimeMs = timed.getElapsedMs();
        let previousUrl = null;
        const redirectTracker = createRedirectChainTracker(url, MAX_REDIRECT_HOPS);

        function emitRedirectChainSummary() {
            if (shouldAbortCrawl(session)) {
                return;
            }
            if (redirectTracker.hopCount === 0 && !redirectTracker.infinite) {
                return;
            }
            emitSpiderResult(browserWindow, buildResultWithIndexing(robots, robotsText, url, {
                status: redirectTracker.firstHopStatus ?? response.status,
                url,
                title: '',
                referrers,
                responseTimeMs: redirectTracker.firstHopResponseTimeMs ?? responseTimeMs,
                ...redirectTracker.toFields(),
            }, null, response));
        }

        while (isRedirectStatus(response.status) && redirectTracker.canFollow()) {
            if (shouldAbortCrawl(session)) {
                return;
            }
            const redirectUrl = resolveRedirectTarget(currentUrl, response.headers.get('location'));

            if (!shouldAbortCrawl(session)) {
            emitSpiderResult(browserWindow, buildResultWithIndexing(robots, robotsText, currentUrl, {
                status: response.status,
                url: currentUrl,
                title: '',
                referrers: previousUrl === null ? referrers : [referrerEntry(previousUrl)],
                redirectUrl: redirectUrl,
                responseTimeMs,
                ...redirectHopOnlyFields(url, currentUrl),
            }, null, response));
            }

            if (!redirectUrl) {
                emitRedirectChainSummary();
                return;
            }

            if (redirectUrl === currentUrl) {
                redirectTracker.markInfinite(currentUrl);
                emitRedirectChainSummary();
                return;
            }

            if (redirectTracker.chainUrls.includes(redirectUrl)) {
                redirectTracker.recordHop({
                    from: currentUrl,
                    to: redirectUrl,
                    status: response.status,
                    responseTimeMs,
                });
                redirectTracker.markInfinite(redirectUrl);
                emitRedirectChainSummary();
                return;
            }

            if (shouldAbortCrawl(session)) {
                return;
            }

            try {
                if (!isSameHost(redirectUrl, urlObject.hostname)) {
                    redirectTracker.recordHop({
                        from: currentUrl,
                        to: redirectUrl,
                        status: response.status,
                        responseTimeMs,
                    });
                    emitRedirectChainSummary();
                    return;
                }
            } catch {
                emitRedirectChainSummary();
                return;
            }

            redirectTracker.recordHop({
                from: currentUrl,
                to: redirectUrl,
                status: response.status,
                responseTimeMs,
            });
            previousUrl = currentUrl;
            currentUrl = redirectUrl;

            if (visitedUrls.has(currentUrl)) {
                redirectTracker.markInfinite(currentUrl);
                emitRedirectChainSummary();
                return;
            }
            visitedUrls.add(currentUrl);

            addReferrer(currentUrl, previousUrl);

            if (shouldBlockByRobotsTxt(robots, currentUrl)) {
                if (!shouldAbortCrawl(session)) {
                    sendRobotsBlockedResult(
                        browserWindow,
                        robots,
                        robotsText,
                        currentUrl,
                        [referrerEntry(previousUrl)]
                    );
                    emitRedirectChainSummary();
                }
                return;
            }

            timed = await timedFetch(currentUrl);
            response = timed.response;
            responseTimeMs = timed.getElapsedMs();
            if (shouldAbortCrawl(session)) {
                return;
            }
        }

        if (shouldAbortCrawl(session)) {
            return;
        }

        if (isRedirectStatus(response.status)) {
            redirectTracker.markInfinite();
            emitSpiderResult(browserWindow, buildResultWithIndexing(robots, robotsText, currentUrl, {
                status: response.status,
                url: currentUrl,
                title: '',
                referrers: previousUrl === null ? referrers : [referrerEntry(previousUrl)],
                redirectUrl: resolveRedirectTarget(currentUrl, response.headers.get('location')),
                responseTimeMs,
                ...redirectHopOnlyFields(url, currentUrl),
            }, null, response));
            emitRedirectChainSummary();
            return;
        }

        if (redirectTracker.hopCount > 0) {
            emitRedirectChainSummary();
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
                null,
                response
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
                null,
                response
            ));
            return;
        }

        const html = await response.text();
        responseTimeMs = timed.getElapsedMs();
        if (shouldAbortCrawl(session)) {
            return;
        }
        const parsed = await parseHtmlDocumentAsync(html, currentUrl, urlObject.hostname);
        if (shouldAbortCrawl(session)) {
            return;
        }
        const pageFields = extractPageViaHooks({
            response,
            url: currentUrl,
            hostname: urlObject.hostname,
            robots,
            robotsText,
        }, parsed.pageFields);
        const {
            metaRobotsRaw = '',
            title = '',
            metaDescription = '',
            metaCanonical = '',
            headings = [],
            ...pluginPageFields
        } = pageFields;
        const metaRobotsParsed = parseMetaRobotsDirective(metaRobotsRaw);
        const xRobotsParsed = parseMetaRobotsDirective(getXRobotsTag(response) || '');
        const blocksFollow = metaRobotsParsed.blocksFollow || xRobotsParsed.blocksFollow;

        if (shouldAbortCrawl(session)) {
            return;
        }

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
            metaRobotsRaw,
            response
        ));

        if (!session?.stopped) {
            await reportDiscoveredLinks(
                browserWindow,
                parsed.pageLinks,
                currentUrl,
                urlObject.hostname,
                { follow: !blocksFollow }
            );
            if (blocksFollow) {
                console.log(`Знайдено nofollow на сторінці: ${currentUrl}`);
            }
        }
    } catch (error) {
        if (shouldAbortCrawl(session)) {
            return;
        }
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

async function completeScan(session, endMessage) {
    if (session.finished) {
        return;
    }
    await terminateHtmlParsePool();
    sendFinalProgress(session, endMessage);
    session.finished = true;
    if (getScanSession() === session) {
        clearScanSession();
        clearScanAuthContext();
        clearScanUserAgent();
        clearScanRequestDelayMs();
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
    await terminateHtmlParsePool();

    const useSitemap = options?.useSitemap ?? false;
    setMaxPagesToVisit(Math.max(0, parseInt(options?.maxPages, 10) || 0));
    const concurrency = Math.min(
        MAX_CONCURRENCY,
        Math.max(1, parseInt(options?.concurrency, 10) || 1)
    );
    const scanHostname = new URL(startUrl).hostname;

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
                        if (!this.stopped) {
                            this.sendProgress();
                        } else if (this.activeWorkers > 0) {
                            this.sendProgress('Зупинка...');
                        }
                    });
            }

            this.tryFinishOrPump();
        },
    };

    setScanSession(session);

    clearCrawlRuntime();
    clearReferrers();
    setScanAuthContext({
        hostname: scanHostname,
        ...normalizeAuthSettings(options),
    });
    setRespectRobotsTxt(options?.respectRobotsTxt !== false);
    setScanUserAgent(resolveUserAgent(options));
    setScanRequestDelayMs(options?.requestDelayMs);

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
    clearScanAuthContext();
    clearScanUserAgent();
    clearScanRequestDelayMs();
    setRespectRobotsTxt(true);
    void terminateHtmlParsePool();
}

module.exports = {
    DEFAULT_USER_AGENT,
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
    collectPageLinks: require('./link-collector').collectPageLinks,
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
    stopSpiderSession,
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
