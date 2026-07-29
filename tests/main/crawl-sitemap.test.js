const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    fetchSitemapPageUrls,
    mapWithConcurrency,
    normalizeSitemapUrlList,
    discoverSitemapUrls,
} = require('../../src/main/crawl-sitemap');
const {
    setFetchForTests,
    resetFetchForTests,
} = require('../../src/main/crawl-network');
const { setScanRequestDelayMs, clearScanRequestDelayMs } = require('../../src/main/request-delay');

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

function urlsetBody(urls) {
    const locs = urls.map((url) => `<url><loc>${url}</loc></url>`).join('');
    return `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</urlset>`;
}

function sitemapIndexBody(nestedUrls) {
    const locs = nestedUrls.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join('');
    return `<?xml version="1.0"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</sitemapindex>`;
}

describe('crawl-sitemap', () => {
    beforeEach(() => {
        clearScanRequestDelayMs();
    });

    afterEach(() => {
        resetFetchForTests();
        clearScanRequestDelayMs();
    });

    it('mapWithConcurrency limits parallel workers', async () => {
        let active = 0;
        let maxActive = 0;
        const items = [1, 2, 3, 4, 5];

        await mapWithConcurrency(
            items,
            async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => {
                    setTimeout(resolve, 30);
                });
                active -= 1;
            },
            2
        );

        assert.equal(maxActive, 2);
    });

    it('fetchSitemapPageUrls fetches nested sitemaps with concurrency', async () => {
        let active = 0;
        let maxActive = 0;
        const nested = [
            'https://example.com/sitemap-a.xml',
            'https://example.com/sitemap-b.xml',
            'https://example.com/sitemap-c.xml',
            'https://example.com/sitemap-d.xml',
        ];

        setFetchForTests(async (url) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => {
                setTimeout(resolve, 40);
            });
            active -= 1;

            if (url.endsWith('/sitemap_index.xml')) {
                return mockResponse({ body: sitemapIndexBody(nested) });
            }
            if (url.endsWith('/sitemap-a.xml')) {
                return mockResponse({ body: urlsetBody(['https://example.com/a']) });
            }
            if (url.endsWith('/sitemap-b.xml')) {
                return mockResponse({ body: urlsetBody(['https://example.com/b']) });
            }
            if (url.endsWith('/sitemap-c.xml')) {
                return mockResponse({ body: urlsetBody(['https://example.com/c']) });
            }
            if (url.endsWith('/sitemap-d.xml')) {
                return mockResponse({ body: urlsetBody(['https://example.com/d']) });
            }
            return mockResponse({ status: 404 });
        });

        const urls = await fetchSitemapPageUrls(
            'https://example.com/sitemap_index.xml',
            'example.com',
            new Set(),
            { concurrency: 3 }
        );

        assert.deepEqual(urls.sort(), [
            'https://example.com/a',
            'https://example.com/b',
            'https://example.com/c',
            'https://example.com/d',
        ]);
        assert.ok(maxActive >= 3, `expected at least 3 parallel fetches, got ${maxActive}`);
        assert.ok(maxActive <= 3, `expected at most 3 parallel fetches, got ${maxActive}`);
    });

    it('fetchSitemapPageUrls waits requestDelayMs between fetches', async () => {
        setScanRequestDelayMs(120);
        let fetchCount = 0;
        const startedAt = Date.now();

        setFetchForTests(async (url) => {
            fetchCount += 1;
            if (url.endsWith('/sitemap_index.xml')) {
                return mockResponse({
                    body: sitemapIndexBody(['https://example.com/sitemap-a.xml']),
                });
            }
            return mockResponse({
                body: urlsetBody(['https://example.com/a']),
            });
        });

        await fetchSitemapPageUrls(
            'https://example.com/sitemap_index.xml',
            'example.com',
            new Set(),
            { concurrency: 1 }
        );

        const elapsedMs = Date.now() - startedAt;
        assert.equal(fetchCount, 2);
        assert.ok(elapsedMs >= 120, `expected delay between fetches, got ${elapsedMs}ms`);
    });

    it('normalizeSitemapUrlList resolves relative paths and skips comments', () => {
        const urls = normalizeSitemapUrlList(
            '# comment\n/custom.xml\nhttps://example.com/a.xml\n/custom.xml\n',
            'https://example.com/page'
        );
        assert.deepEqual(urls, [
            'https://example.com/custom.xml',
            'https://example.com/a.xml',
        ]);
    });

    it('discoverSitemapUrls uses custom list and skips robots', async () => {
        let robotsCalled = false;
        const urls = await discoverSitemapUrls(
            'https://example.com/',
            async () => {
                robotsCalled = true;
                return { text: 'Sitemap: https://example.com/from-robots.xml' };
            },
            {
                sitemapUrls: [
                    'https://example.com/custom-a.xml',
                    '/custom-b.xml',
                ],
            }
        );
        assert.equal(robotsCalled, false);
        assert.deepEqual(urls, [
            'https://example.com/custom-a.xml',
            'https://example.com/custom-b.xml',
        ]);
    });

    it('discoverSitemapUrls falls back to robots when custom list empty', async () => {
        const urls = await discoverSitemapUrls(
            'https://example.com/',
            async () => ({ text: 'Sitemap: https://example.com/from-robots.xml\n' }),
            { sitemapUrls: ['', '  ', '# only comment'] }
        );
        assert.deepEqual(urls, ['https://example.com/from-robots.xml']);
    });
});
