const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const {
    resetSpiderStateForTests,
    setFetchForTests,
    resetFetchForTests,
    parseAnchorRel,
    parseMetaRobotsDirective,
    classifyOutlinkKind,
    formatOutlinkTag,
    isCrawlableLink,
    collectPageLinks,
    extractPageTitle,
    extractMetaDescription,
    parseSitemapsFromRobotsTxt,
    fetchSitemapPageUrls,
    enqueueUrl,
    getQueueLength,
    tryClaimUrl,
    getRobotsTxtInfo,
    mergeReferrerMeta,
    crawl,
    startSpider,
    getScanSession,
} = require('../../src/main/spider-logic');
const robotsParser = require('robots-parser');

function mockResponse({ status = 200, headers = {}, body = '' } = {}) {
    const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get: (name) => map.get(String(name).toLowerCase()) || '',
        },
        text: async () => body,
    };
}

function mockWindow() {
    const events = [];
    return {
        webContents: {
            send: (channel, payload) => {
                events.push({ channel, payload });
            },
        },
        _events: events,
    };
}

describe('spider-logic', () => {
    beforeEach(() => {
        resetSpiderStateForTests();
        resetFetchForTests();
    });

    afterEach(() => {
        resetFetchForTests();
        resetSpiderStateForTests();
    });

    it('parseAnchorRel marks nofollow as restricted', () => {
        const parsed = parseAnchorRel('nofollow sponsored');
        assert.equal(parsed.relFollowAllowed, false);
        assert.match(parsed.relLabel, /nofollow/);
    });

    it('parseMetaRobotsDirective detects blocksFollow', () => {
        assert.equal(parseMetaRobotsDirective('noindex, nofollow').blocksFollow, true);
        assert.equal(parseMetaRobotsDirective('noindex').blocksFollow, false);
        assert.equal(parseMetaRobotsDirective('').metaRobotsStatus, 'allowed');
    });

    it('classifyOutlinkKind uses element and extension', () => {
        assert.equal(classifyOutlinkKind('https://x.com/app.js', { element: 'script' }), 'javascript');
        assert.equal(classifyOutlinkKind('https://x.com/', { element: 'anchor' }), 'html');
        assert.equal(classifyOutlinkKind('https://x.com/style.css', { element: 'stylesheet' }), 'css');
    });

    it('formatOutlinkTag maps elements to selectors', () => {
        assert.equal(formatOutlinkTag({ element: 'anchor' }), 'a[href]');
        assert.equal(formatOutlinkTag({ element: 'script' }), 'script[src]');
    });

    it('isCrawlableLink allows navigation tags only', () => {
        assert.equal(isCrawlableLink({ tag: 'a[href]', external: false }), true);
        assert.equal(isCrawlableLink({ tag: 'script[src]', external: false }), false);
        assert.equal(isCrawlableLink({ tag: 'a[href]', external: true }), false);
    });

    it('collectPageLinks deduplicates and resolves URLs', () => {
        const html = `
            <html><head><title>T</title></head><body>
                <a href="/one">One</a>
                <a href="/one">Dup</a>
                <a href="https://other.com/x">Ext</a>
                <script src="/app.js"></script>
            </body></html>`;
        const $ = cheerio.load(html);
        const links = collectPageLinks($, 'https://example.com/start', 'example.com');
        const urls = links.map((l) => l.url);
        assert.ok(urls.includes('https://example.com/one'));
        assert.ok(urls.some((u) => u.includes('other.com')));
        assert.ok(links.find((l) => l.tag === 'script[src]'));
    });

    it('extractPageTitle prefers head title and og fallback', () => {
        const $ = cheerio.load('<html><head><title>Head</title></head></html>');
        assert.equal(extractPageTitle($), 'Head');
        const $og = cheerio.load('<html><head><meta property="og:title" content="OG"></head></html>');
        assert.equal(extractPageTitle($og), 'OG');
    });

    it('extractMetaDescription joins duplicates with semicolon', () => {
        const $ = cheerio.load(`
            <html><head>
                <meta name="description" content="A">
                <meta name="description" content="B">
            </head></html>`);
        assert.equal(extractMetaDescription($), 'A; B');
    });

    it('parseSitemapsFromRobotsTxt extracts sitemap lines', () => {
        const text = 'User-agent: *\nSitemap: https://example.com/sitemap.xml\n';
        assert.deepEqual(parseSitemapsFromRobotsTxt(text), ['https://example.com/sitemap.xml']);
    });

    it('enqueueUrl keeps internal URLs in html or media queue', () => {
        enqueueUrl('https://example.com/', 'N/A', 'example.com');
        enqueueUrl('https://example.com/app.js', 'https://example.com/', 'example.com');
        assert.equal(getQueueLength(), 2);
    });

    it('tryClaimUrl rejects already visited URL', () => {
        assert.equal(tryClaimUrl('https://example.com/1'), true);
        assert.equal(tryClaimUrl('https://example.com/1'), false);
    });

    it('mergeReferrerMeta merges rel flags conservatively', () => {
        const map = new Map();
        mergeReferrerMeta(map, 'https://a', { relFollowAllowed: true, text: 'A' });
        mergeReferrerMeta(map, 'https://a', { relFollowAllowed: false, text: 'B' });
        assert.equal(map.get('https://a').relFollowAllowed, false);
        assert.match(map.get('https://a').text, /A/);
    });

    it('getRobotsTxtInfo reports allowed when no rule', () => {
        const robots = robotsParser('https://example.com/robots.txt', '');
        const info = getRobotsTxtInfo(robots, '', 'https://example.com/page');
        assert.equal(info.robotsAllowed, true);
    });

    it('crawl fetches html page and emits spider-result', async () => {
        const win = mockWindow();
        setFetchForTests(async (url) => {
            if (url.includes('robots.txt')) {
                return mockResponse({ status: 404, body: '' });
            }
            return mockResponse({
                status: 200,
                headers: { 'content-type': 'text/html' },
                body: '<html><head><title>Home</title></head><body><a href="/next">N</a></body></html>',
            });
        });

        await crawl('https://example.com/', 'N/A', win);
        const result = win._events.find((e) => e.channel === 'spider-result');
        assert.ok(result);
        assert.equal(result.payload.title, 'Home');
        assert.equal(result.payload.status, 200);
    });

    it('crawl follows same-host redirect chain', async () => {
        const win = mockWindow();
        setFetchForTests(async (url) => {
            if (url.includes('robots.txt')) {
                return mockResponse({ status: 404 });
            }
            if (url.endsWith('/old')) {
                return mockResponse({ status: 301, headers: { location: '/new' } });
            }
            return mockResponse({
                status: 200,
                headers: { 'content-type': 'text/html' },
                body: '<html><head><title>New</title></head></html>',
            });
        });

        await crawl('https://example.com/old', 'N/A', win);
        const results = win._events.filter((e) => e.channel === 'spider-result');
        assert.equal(results.length, 2);
        assert.equal(results[0].payload.status, 301);
        assert.equal(results[1].payload.title, 'New');
    });

    it('crawl skips URL blocked by robots.txt', async () => {
        const win = mockWindow();
        setFetchForTests(async (url) => {
            if (url.includes('robots.txt')) {
                return mockResponse({
                    status: 200,
                    body: 'User-agent: MyElectronSpider/1.0\nDisallow: /secret\n',
                });
            }
            return mockResponse({ status: 200, body: 'nope' });
        });

        await crawl('https://example.com/secret', 'N/A', win);
        const result = win._events.find((e) => e.channel === 'spider-result');
        assert.equal(result.payload.status, 'SKIPPED');
    });

    it('fetchSitemapPageUrls parses urlset', async () => {
        setFetchForTests(async () => mockResponse({
            status: 200,
            body: `<?xml version="1.0"?>
                <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                    <url><loc>https://example.com/a</loc></url>
                    <url><loc>https://other.com/b</loc></url>
                </urlset>`,
        }));
        const urls = await fetchSitemapPageUrls('https://example.com/sitemap.xml', 'example.com', new Set());
        assert.deepEqual(urls, ['https://example.com/a']);
    });

    it('crawl respects meta robots nofollow', async () => {
        const win = mockWindow();
        setFetchForTests(async (url) => {
            if (url.includes('robots.txt')) {
                return mockResponse({ status: 404 });
            }
            return mockResponse({
                status: 200,
                headers: { 'content-type': 'text/html' },
                body: '<html><head><meta name="robots" content="nofollow"></head><body><a href="/hidden">x</a></body></html>',
            });
        });

        await crawl('https://example.com/', 'N/A', win);
        assert.equal(getQueueLength(), 0);
    });

    it('startSpider completes small site scan', async () => {
        const win = mockWindow();
        setFetchForTests(async (url) => {
            if (url.includes('robots.txt')) {
                return mockResponse({ status: 404 });
            }
            if (url.endsWith('/')) {
                return mockResponse({
                    status: 200,
                    headers: { 'content-type': 'text/html' },
                    body: '<html><head><title>Root</title></head><body><a href="/child">c</a></body></html>',
                });
            }
            return mockResponse({
                status: 200,
                headers: { 'content-type': 'text/html' },
                body: '<html><head><title>Child</title></head></html>',
            });
        });

        await startSpider('https://example.com/', { maxPages: 2, concurrency: 1 }, win);

        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
            if (!getScanSession()) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
        }

        assert.equal(getScanSession(), null);
        const end = win._events.find((e) => e.channel === 'spider-end');
        assert.ok(end);
        const results = win._events.filter((e) => e.channel === 'spider-result');
        assert.ok(results.length >= 2);
    });
});
