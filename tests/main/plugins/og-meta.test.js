const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { crawlHookRegistry } = require('../../../src/main/crawl-hooks');
const { registerDefaultCrawlHooks } = require('../../../src/main/crawl-defaults');
const { extractOgFields, registerOgMetaPlugin } = require('../../../src/main/plugins/og-meta');
const { extractPageViaHooks } = require('../../../src/main/crawl-hooks');

describe('og-meta plugin (main)', () => {
    beforeEach(() => {
        crawlHookRegistry.clear();
        registerDefaultCrawlHooks();
        registerOgMetaPlugin();
    });

    it('extractOgFields reads Open Graph meta tags', () => {
        const $ = cheerio.load(`
            <html><head>
                <meta property="og:title" content="OG Title" />
                <meta property="og:description" content="OG Desc" />
                <meta property="og:image" content="https://cdn.example/og.png" />
            </head></html>
        `);
        const fields = extractOgFields($);
        assert.equal(fields.ogTitle, 'OG Title');
        assert.equal(fields.ogDescription, 'OG Desc');
        assert.equal(fields.ogImage, 'https://cdn.example/og.png');
    });

    it('integrates with crawl:extractPage waterfall', () => {
        const $ = cheerio.load(`
            <html><head>
                <title>Page</title>
                <meta property="og:image" content="https://cdn.example/card.jpg" />
            </head></html>
        `);
        const fields = extractPageViaHooks({
            $,
            response: { headers: { get: () => '' } },
            url: 'https://example.com/',
            hostname: 'example.com',
        });
        assert.equal(fields.title, 'Page');
        assert.equal(fields.ogImage, 'https://cdn.example/card.jpg');
    });
});
