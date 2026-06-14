const { getXRobotsTag } = require('./page-extractors');
const {
    isRedirectStatus,
    resolveRedirectTarget,
    getContentType,
} = require('../shared/url-utils');
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
    ROBOTS_UA,
    MAX_REDIRECT_HOPS,
    timedFetch,
    getRobots,
    getRobotsTxtFieldsForUrl,
    sendRobotsBlockedResult,
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
        ...fields,
    };
}

async function probeDiscoveredLink(url, referrer, link, browserWindow) {
    if (probedDiscoveredUrls.has(url)) {
        return;
    }
    probedDiscoveredUrls.add(url);

    if (!link.external) {
        const urlObject = new URL(url);
        const { parser, text } = await getRobots(urlObject);
        if (!parser.isAllowed(url, ROBOTS_UA)) {
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
        let hop = 0;

        while (isRedirectStatus(response.status) && hop < MAX_REDIRECT_HOPS) {
            const redirectUrl = resolveRedirectTarget(currentUrl, response.headers.get('location'));
            if (!redirectUrl || redirectUrl === currentUrl) {
                break;
            }
            currentUrl = redirectUrl;
            hop++;
            timed = await timedFetch(currentUrl);
            response = timed.response;
            responseTimeMs = timed.getElapsedMs();
        }

        const { parser, text } = await getRobots(new URL(currentUrl));
        emitSpiderResult(browserWindow, buildResultWithIndexing(
            parser,
            text,
            url,
            buildProbeLinkFields(url, link, {
                status: response.status,
                contentType: getContentType(response),
                responseTimeMs,
                redirectUrl: currentUrl !== url ? currentUrl : undefined,
            }),
            getXRobotsTag(response) || null
        ));
    } catch (error) {
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

async function reportDiscoveredLinks(browserWindow, links, sourceUrl, allowedHostname, { follow = true } = {}) {
    const stubs = [];
    const filteredLinks = filterDiscoveredLinksViaHooks(
        { sourceUrl, allowedHostname, follow, browserWindow },
        links
    );

    for (const link of filteredLinks) {
        const referrerMeta = buildReferrerLinkMeta(link);
        const robotsFields = link.external
            ? { robotsAllowed: null, robotsRule: '' }
            : await getRobotsTxtFieldsForUrl(link.url);
        const internalRobotsBlocked = !link.external && robotsFields.robotsAllowed === false;

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

        if (!internalRobotsBlocked) {
            enqueueProbeUrl(link.url, sourceUrl, link);
        }

        if (reportedStubUrls.has(link.url)) {
            continue;
        }

        const crawlableInternal = follow && !link.external && isCrawlableLink(link);
        if (crawlableInternal && (visitedUrls.has(link.url) || isUrlQueued(link.url))) {
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
