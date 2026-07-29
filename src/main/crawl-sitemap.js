const cheerio = require('cheerio');
const { normalizePageUrl, isSameHost, isRedirectStatus, resolveRedirectTarget } = require('../shared/url-utils');
const { fetchPage } = require('./crawl-network');
const { enqueueUrl, getQueueLength } = require('./crawl-queue');
const { isInternalRobotsDisallowed } = require('./crawl-network');

const FALLBACK_SITEMAP_PATHS = ['/sitemap_index.xml', '/sitemap.xml', '/index.xml'];
/** Sitemap XML can be large; page crawl keeps the shorter FETCH_TIMEOUT_MS. */
const SITEMAP_FETCH_TIMEOUT_MS = 60_000;

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

/** Normalize user/robots sitemap list: lines or array → absolute unique URLs. */
function normalizeSitemapUrlList(raw, startUrl) {
    const lines = Array.isArray(raw)
        ? raw
        : String(raw || '').split(/\r?\n/);
    let base;
    try {
        const origin = new URL(startUrl);
        base = `${origin.protocol}//${origin.host}`;
    } catch {
        return [];
    }
    const result = [];
    const seen = new Set();
    for (const line of lines) {
        const trimmed = String(line || '').trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        let href;
        try {
            href = new URL(trimmed, base).href;
        } catch {
            continue;
        }
        if (seen.has(href)) {
            continue;
        }
        seen.add(href);
        result.push(href);
    }
    return result;
}

async function mapWithConcurrency(items, fn, concurrency, shouldAbort) {
    if (items.length === 0) {
        return [];
    }
    const limit = Math.max(1, concurrency);
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            if (shouldAbort?.()) {
                return;
            }
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                return;
            }
            results[index] = await fn(items[index], index);
        }
    }

    const workers = Array.from(
        { length: Math.min(limit, items.length) },
        () => worker()
    );
    await Promise.all(workers);
    return results;
}

async function fetchSitemapResponse(sitemapUrl, allowedHostname, maxHops = 5) {
    let currentUrl = sitemapUrl;
    const fetchOpts = { timeoutMs: SITEMAP_FETCH_TIMEOUT_MS };
    for (let hop = 0; hop <= maxHops; hop += 1) {
        const response = await fetchPage(currentUrl, fetchOpts);
        if (!isRedirectStatus(response.status)) {
            return { response, finalUrl: currentUrl };
        }
        const nextUrl = resolveRedirectTarget(currentUrl, response.headers.get('location'));
        if (!nextUrl) {
            return { response, finalUrl: currentUrl };
        }
        try {
            if (!isSameHost(nextUrl, allowedHostname)) {
                return { response, finalUrl: currentUrl };
            }
        } catch {
            return { response, finalUrl: currentUrl };
        }
        currentUrl = nextUrl;
    }
    const response = await fetchPage(currentUrl, fetchOpts);
    return { response, finalUrl: currentUrl };
}

async function fetchSitemapPageUrls(sitemapUrl, allowedHostname, fetchedSitemaps, hooks = {}) {
    const { onLeafUrls, shouldAbort, concurrency = 1 } = hooks;

    if (shouldAbort?.()) {
        return [];
    }
    if (fetchedSitemaps.has(sitemapUrl)) {
        return [];
    }
    fetchedSitemaps.add(sitemapUrl);

    try {
        const { response, finalUrl } = await fetchSitemapResponse(sitemapUrl, allowedHostname);
        if (shouldAbort?.()) {
            return [];
        }
        if (!response.ok) {
            console.log(`Sitemap недоступний (${response.status}): ${finalUrl}`);
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

            const nestedResults = await mapWithConcurrency(
                nestedSitemaps,
                async (nestedUrl) => {
                    if (shouldAbort?.()) {
                        return [];
                    }
                    return fetchSitemapPageUrls(nestedUrl, allowedHostname, fetchedSitemaps, hooks);
                },
                concurrency,
                shouldAbort
            );

            if (!onLeafUrls) {
                for (const nestedPages of nestedResults) {
                    if (nestedPages?.length) {
                        pageUrls.push(...nestedPages);
                    }
                }
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
            } catch {
                // пропускаємо невалідні URL
            }
        };

        $('url loc, url > loc').each((_, el) => collectPageUrl($(el).text().trim()));

        if (pageUrls.length === 0) {
            $('loc').each((_, el) => collectPageUrl($(el).text().trim()));
        }

        if (onLeafUrls) {
            await onLeafUrls(pageUrls, sitemapUrl);
            return [];
        }
        return pageUrls;
    } catch (error) {
        console.error(`Помилка читання sitemap ${sitemapUrl}: ${error.message}`);
        return [];
    }
}

async function discoverSitemapUrls(startUrl, getRobots, options = {}) {
    const customSitemaps = normalizeSitemapUrlList(options.sitemapUrls, startUrl);
    if (customSitemaps.length > 0) {
        return customSitemaps;
    }

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

async function seedQueueFromSitemaps(startUrl, browserWindow, getRobots, session = null, options = {}) {
    const start = new URL(startUrl);
    const concurrency = Math.max(1, session?.concurrency || 1);
    const sitemapUrls = await discoverSitemapUrls(startUrl, getRobots, options);
    if (session?.stopped) {
        return 0;
    }

    const fetchedSitemaps = new Set();
    const pageUrls = new Set();
    let leafFilesDone = 0;

    const sendSitemapProgress = (status) => {
        browserWindow.webContents.send('spider-progress', {
            scanned: 0,
            queue: getQueueLength(),
            status,
        });
    };

    sendSitemapProgress(`Пошук sitemap (${sitemapUrls.length})...`);

    const onLeafUrls = async (urls, sitemapUrl) => {
        const fileNum = leafFilesDone + 1;
        leafFilesDone = fileNum;
        for (const pageUrl of urls) {
            if (session?.stopped) {
                return;
            }
            pageUrls.add(pageUrl);
            if (await isInternalRobotsDisallowed(pageUrl, start.hostname)) {
                continue;
            }
            enqueueUrl(pageUrl, sitemapUrl, start.hostname, 'sitemap');
        }
        sendSitemapProgress(
            `Sitemap ${fileNum}: у черзі ${getQueueLength()}`
        );
    };

    const hooks = {
        onLeafUrls,
        shouldAbort: () => Boolean(session?.stopped),
        concurrency,
    };

    await mapWithConcurrency(
        sitemapUrls,
        async (sitemapUrl) => {
            if (session?.stopped) {
                return;
            }
            await fetchSitemapPageUrls(sitemapUrl, start.hostname, fetchedSitemaps, hooks);
        },
        concurrency,
        () => Boolean(session?.stopped)
    );

    console.log(`У sitemap знайдено сторінок: ${pageUrls.size}`);
    return pageUrls.size;
}

module.exports = {
    FALLBACK_SITEMAP_PATHS,
    SITEMAP_FETCH_TIMEOUT_MS,
    parseSitemapsFromRobotsTxt,
    normalizeSitemapUrlList,
    mapWithConcurrency,
    fetchSitemapPageUrls,
    discoverSitemapUrls,
    seedQueueFromSitemaps,
};
