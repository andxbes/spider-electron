const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const robotsParser = require('robots-parser');
const {
    buildResultWithIndexing,
    getResponseHeaderFields,
} = require('../../src/main/crawl-results');

function mockResponse(headers = {}) {
    const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        headers: {
            get: (name) => map.get(String(name).toLowerCase()) || '',
            entries: function* entries() {
                for (const [k, v] of map) {
                    yield [k, v];
                }
            },
        },
    };
}

describe('crawl-results response headers', () => {
    it('getResponseHeaderFields parses X-Robots-Tag separately', () => {
        const fields = getResponseHeaderFields(mockResponse({
            'x-robots-tag': 'noindex, nofollow',
            'cache-control': 'no-cache',
        }));
        assert.equal(fields.xRobotsTag, 'noindex, nofollow');
        assert.equal(fields.xRobotsTagStatus, 'closed');
        assert.equal(fields.responseHeaders.length, 2);
    });

    it('buildResultWithIndexing keeps meta robots and X-Robots-Tag separate', () => {
        const robots = robotsParser('https://example.com/robots.txt', '');
        const result = buildResultWithIndexing(
            robots,
            '',
            'https://example.com/page',
            { status: 200, url: 'https://example.com/page', title: 'Page' },
            'noindex',
            mockResponse({ 'x-robots-tag': 'nofollow' })
        );
        assert.equal(result.metaRobots, 'noindex');
        assert.equal(result.metaRobotsStatus, 'noindex');
        assert.equal(result.xRobotsTag, 'nofollow');
        assert.equal(result.xRobotsTagStatus, 'nofollow');
        assert.ok(result.responseHeaders.some((header) => header.name === 'x-robots-tag'));
    });
});
