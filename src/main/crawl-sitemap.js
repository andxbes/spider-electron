const cheerio = require('cheerio');
const { normalizePageUrl, isSameHost, isRedirectStatus, resolveRedirectTarget } = require('../shared/url-utils');
const { fetchPage } = require('./crawl-network');
const { enqueueUrl } = require('./crawl-queue');
const { isInternalRobotsDisallowed } = require('./crawl-network');

const FALLBACK_SITEMAP_PATHS = ['/sitemap_index.xml', '/sitemap.xml', '/index.xml'];

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

async function fetchSitemapResponse(sitemapUrl, allowedHostname, maxHops = 5) {
    let currentUrl = sitemapUrl;
    for (let hop = 0; hop <= maxHops; hop += 1) {
        const response = await fetchPage(currentUrl);
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
    const response = await fetchPage(currentUrl);
    return { response, finalUrl: currentUrl };
}

async function fetchSitemapPageUrls(sitemapUrl, allowedHostname, fetchedSitemaps) {
    if (fetchedSitemaps.has(sitemapUrl)) {
        return [];
    }
    fetchedSitemaps.add(sitemapUrl);

    try {
        const { response, finalUrl } = await fetchSitemapResponse(sitemapUrl, allowedHostname);
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
            } catch {
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

async function discoverSitemapUrls(startUrl, getRobots) {
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

async function seedQueueFromSitemaps(startUrl, browserWindow, getRobots) {
    const start = new URL(startUrl);
    const sitemapUrls = await discoverSitemapUrls(startUrl, getRobots);
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
            if (await isInternalRobotsDisallowed(pageUrl, start.hostname)) {
                continue;
            }
            enqueueUrl(pageUrl, sitemapUrl, start.hostname, 'sitemap');
        }
    }

    console.log(`У sitemap знайдено сторінок: ${pageUrls.size}`);
    return pageUrls.size;
}

module.exports = {
    FALLBACK_SITEMAP_PATHS,
    parseSitemapsFromRobotsTxt,
    fetchSitemapPageUrls,
    discoverSitemapUrls,
    seedQueueFromSitemaps,
};
