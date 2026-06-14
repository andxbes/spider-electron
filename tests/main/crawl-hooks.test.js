const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    CRAWL_HOOKS,
    crawlHookRegistry,
    emitSpiderResult,
    extractPageViaHooks,
    filterDiscoveredLinksViaHooks,
} = require('../../src/main/crawl-hooks');
const { registerDefaultCrawlHooks } = require('../../src/main/crawl-defaults');

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

describe('crawl-hooks', () => {
    beforeEach(() => {
        crawlHookRegistry.clear();
        registerDefaultCrawlHooks();
    });

    it('extractPageViaHooks runs default extractors', () => {
        const cheerio = require('cheerio');
        const $ = cheerio.load('<html><head><title>Test</title></head><body><h1>Hi</h1></body></html>');
        const fields = extractPageViaHooks({
            $,
            response: { headers: { get: () => '' } },
            url: 'https://example.com/',
            hostname: 'example.com',
        });
        assert.equal(fields.title, 'Test');
        assert.equal(fields.headings.length, 1);
        assert.equal(fields.headings[0].text, 'Hi');
    });

    it('BUILD_RESULT hook can extend emitted payload', () => {
        const win = mockWindow();
        crawlHookRegistry.register(CRAWL_HOOKS.BUILD_RESULT, (_ctx, result) => ({
            ...result,
            customField: 'yes',
        }), { priority: 50, id: 'test-ext' });

        emitSpiderResult(win, { url: 'https://example.com/', status: 200 });
        assert.equal(win._events[0].payload.customField, 'yes');
    });

    it('BEFORE_EMIT_RESULT false skips IPC send', () => {
        const win = mockWindow();
        crawlHookRegistry.register(CRAWL_HOOKS.BEFORE_EMIT_RESULT, () => false, {
            priority: 50,
            id: 'test-skip',
        });

        const result = emitSpiderResult(win, { url: 'https://example.com/' });
        assert.equal(result, null);
        assert.equal(win._events.length, 0);
    });

    it('FILTER_DISCOVERED_LINK removes links', () => {
        const links = [
            { url: 'https://example.com/a', external: false },
            { url: 'https://evil.com/b', external: true },
        ];
        crawlHookRegistry.register(CRAWL_HOOKS.FILTER_DISCOVERED_LINK, (_ctx, link) => !link.external, {
            priority: 50,
            id: 'test-filter',
        });
        const filtered = filterDiscoveredLinksViaHooks({}, links);
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].url, 'https://example.com/a');
    });
});
