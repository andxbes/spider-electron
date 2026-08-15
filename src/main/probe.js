const {
    isRedirectStatus,
    resolveRedirectTarget,
    getContentType,
    normalizePageUrl,
    isEmptyImageUrl,
} = require('../shared/url-utils');
const { createRedirectChainTracker } = require('../shared/redirect-chain');
const { isCrawlableLink } = require('./link-collector');
const {
    emitSpiderResult,
    emitSpiderResultsBatch,
    filterDiscoveredLinksViaHooks,
} = require('./crawl-hooks');
const {
    visitedUrls,
    reportedStubUrls,
    probedDiscoveredUrls,
    getRespectRobotsTxt,
    getScanSession,
} = require('./crawl-state');
const {
    buildSpiderResult,
    buildResultWithIndexing,
} = require('./crawl-results');
const {
    addReferrer,
    getReferrersListForUrl,
    buildReferrerLinkMeta,
} = require('./crawl-referrers');
const {
    enqueueUrl,
    enqueueProbeUrl,
    isUrlQueued,
} = require('./crawl-queue');
const {
    MAX_REDIRECT_HOPS,
    timedFetch,
    getRobots,
    getRobotsTxtFieldsForUrl,
    sendRobotsBlockedResult,
    shouldBlockByRobotsTxt,
} = require('./crawl-network');

function buildDiscoveredLinkResult(link) {
    return buildSpiderResult({
        url: link.url,
        status: '',
        title: '',
        text: String(link.text || '').trim(),
        external: Boolean(link.external),
        fetched: false,
        kind: link.kind || '',
        tag: link.tag || '',
        rel: link.rel || '',
        relFollowAllowed: link.relFollowAllowed,
        relIndexAllowed: link.relIndexAllowed,
        relLabel: link.relLabel || '',
        referrers: getReferrersListForUrl(link.url),
        ...(link.imgAltMissing === true ? { imgAltMissing: true } : {}),
        ...(link.imgAlt !== undefined ? { imgAlt: link.imgAlt } : {}),
        ...(link.emptySrc === true ? { emptySrc: true } : {}),
    });
}

function buildRobotsBlockedStub(link, robotsFields) {
    return {
        ...buildDiscoveredLinkResult(link),
        ...robotsFields,
        status: 0,
        fetched: true,
    };
}

function buildProbeLinkFields(url, link, fields) {
    return {
        url,
        title: '',
        text: String(link.text || '').trim(),
        external: Boolean(link.external),
        fetched: true,
        kind: link.kind || '',
        tag: link.tag || '',
        rel: link.rel || '',
        relFollowAllowed: link.relFollowAllowed,
        relIndexAllowed: link.relIndexAllowed,
        relLabel: link.relLabel || '',
        referrers: getReferrersListForUrl(url),
        ...(link.imgAltMissing === true ? { imgAltMissing: true } : {}),
        ...(link.imgAlt !== undefined ? { imgAlt: link.imgAlt } : {}),
        ...(link.emptySrc === true ? { emptySrc: true } : {}),
        ...fields,
    };
}

async function probeDiscoveredLink(url, referrer, link, browserWindow) {
    let normalizedUrl = url;
    try {
        normalizedUrl = normalizePageUrl(url);
    } catch {
        return;
    }
    if (probedDiscoveredUrls.has(normalizedUrl)) {
        return;
    }
    // Already fully crawled — do not overwrite crawl result (e.g. 3xx + chain) with probe.
    if (!link.external && visitedUrls.has(normalizedUrl)) {
        probedDiscoveredUrls.add(normalizedUrl);
        return;
    }
    probedDiscoveredUrls.add(normalizedUrl);

    if (!link.external) {
        const urlObject = new URL(url);
        const { parser, text } = await getRobots(urlObject);
        if (shouldBlockByRobotsTxt(parser, url)) {
            sendRobotsBlockedResult(
                browserWindow,
                parser,
                text,
                url,
                getReferrersListForUrl(url)
            );
            return;
        }
    }

    const label = link.external ? 'зовнішнє посилання' : 'ресурс';
    console.log(`Перевіряю ${label}: ${url}`);

    try {
        let currentUrl = url;
        let timed = await timedFetch(currentUrl);
        let response = timed.response;
        let responseTimeMs = timed.getElapsedMs();
        const redirectTracker = createRedirectChainTracker(url, MAX_REDIRECT_HOPS);

        while (isRedirectStatus(response.status) && redirectTracker.canFollow()) {
            if (shouldAbortProbe()) {
                return;
            }
            const redirectUrl = resolveRedirectTarget(currentUrl, response.headers.get('location'));
            if (!redirectUrl || redirectUrl === currentUrl) {
                if (redirectUrl === currentUrl) {
                    redirectTracker.markInfinite(currentUrl);
                }
                break;
            }
            if (redirectTracker.chainUrls.includes(redirectUrl)) {
                redirectTracker.recordHop({
                    from: currentUrl,
                    to: redirectUrl,
                    status: response.status,
                    responseTimeMs,
                });
                redirectTracker.markInfinite(redirectUrl);
                break;
            }
            redirectTracker.recordHop({
                from: currentUrl,
                to: redirectUrl,
                status: response.status,
                responseTimeMs,
            });
            currentUrl = redirectUrl;
            timed = await timedFetch(currentUrl);
            response = timed.response;
            responseTimeMs = timed.getElapsedMs();
            if (shouldAbortProbe()) {
                return;
            }
        }

        if (isRedirectStatus(response.status) && !redirectTracker.infinite) {
            redirectTracker.markInfinite();
        }

        if (shouldAbortProbe()) {
            return;
        }

        const { parser, text } = await getRobots(new URL(currentUrl));
        const redirectFields = redirectTracker.toFields();
        const status = redirectTracker.hopCount > 0
            ? (redirectTracker.firstHopStatus ?? response.status)
            : response.status;
        const probeResponseTimeMs = redirectTracker.hopCount > 0
            ? (redirectTracker.firstHopResponseTimeMs ?? responseTimeMs)
            : responseTimeMs;
        emitSpiderResult(browserWindow, buildResultWithIndexing(
            parser,
            text,
            url,
            buildProbeLinkFields(url, link, {
                status,
                contentType: getContentType(response),
                responseTimeMs: probeResponseTimeMs,
                redirectUrl: redirectFields.redirectUrl || (currentUrl !== url ? currentUrl : undefined),
                ...redirectFields,
            }),
            null,
            response
        ));
    } catch (error) {
        if (shouldAbortProbe()) {
            return;
        }
        console.error(`Помилка перевірки ${label} ${url}: ${error.message}`);
        const { parser, text } = await getRobots(new URL(url)).catch(() => ({ parser: null, text: '' }));
        const fields = buildProbeLinkFields(url, link, { status: 'ERROR' });
        if (parser) {
            emitSpiderResult(browserWindow, buildResultWithIndexing(parser, text, url, fields));
        } else {
            emitSpiderResult(browserWindow, buildSpiderResult({
                ...(await getRobotsTxtFieldsForUrl(url)),
                ...fields,
            }));
        }
    }
}

const probeExternalLink = probeDiscoveredLink;

function shouldAbortProbe() {
    const session = getScanSession();
    if (!session) {
        return false;
    }
    return session.finished || session.stopped;
}

async function reportDiscoveredLinks(browserWindow, links, sourceUrl, allowedHostname, { follow = true } = {}) {
    if (shouldAbortProbe()) {
        return;
    }
    const stubs = [];
    const filteredLinks = filterDiscoveredLinksViaHooks(
        { sourceUrl, allowedHostname, follow, browserWindow },
        links
    );

    for (const link of filteredLinks) {
        const referrerMeta = buildReferrerLinkMeta(link);
        if (link.emptySrc || isEmptyImageUrl(link.url)) {
            addReferrer(link.url, sourceUrl, referrerMeta);
            if (!reportedStubUrls.has(link.url)) {
                reportedStubUrls.add(link.url);
                stubs.push({
                    ...buildDiscoveredLinkResult(link),
                    emptySrc: true,
                    external: false,
                    fetched: false,
                    status: '',
                    robotsAllowed: null,
                    robotsRule: '',
                });
            }
            continue;
        }
        const robotsFields = link.external
            ? { robotsAllowed: null, robotsRule: '' }
            : await getRobotsTxtFieldsForUrl(link.url);
        const internalRobotsBlocked = getRespectRobotsTxt()
            && !link.external
            && robotsFields.robotsAllowed === false;

        if (follow && !link.external && isCrawlableLink(link)) {
            if (internalRobotsBlocked) {
                addReferrer(link.url, sourceUrl, referrerMeta);
                if (!reportedStubUrls.has(link.url)) {
                    reportedStubUrls.add(link.url);
                    stubs.push(buildRobotsBlockedStub(link, robotsFields));
                }
                continue;
            }
            enqueueUrl(link.url, sourceUrl, allowedHostname, referrerMeta);
            continue;
        }

        addReferrer(link.url, sourceUrl, referrerMeta);

        let normalizedLinkUrl = link.url;
        try {
            normalizedLinkUrl = normalizePageUrl(link.url);
        } catch {
            continue;
        }
        const alreadyVisited = !link.external && visitedUrls.has(normalizedLinkUrl);

        if (!internalRobotsBlocked && !alreadyVisited) {
            enqueueProbeUrl(link.url, sourceUrl, link);
        }

        if (reportedStubUrls.has(link.url)) {
            continue;
        }

        const crawlableInternal = follow && !link.external && isCrawlableLink(link);
        if (crawlableInternal && (alreadyVisited || isUrlQueued(link.url))) {
            continue;
        }

        reportedStubUrls.add(link.url);
        if (internalRobotsBlocked) {
            stubs.push(buildRobotsBlockedStub(link, robotsFields));
        } else {
            const stub = buildDiscoveredLinkResult(link);
            Object.assign(stub, robotsFields);
            stubs.push(stub);
        }
    }

    if (stubs.length > 0) {
        emitSpiderResultsBatch(browserWindow, stubs);
    }
}

module.exports = {
    buildDiscoveredLinkResult,
    buildRobotsBlockedStub,
    probeDiscoveredLink,
    probeExternalLink,
    reportDiscoveredLinks,
};
