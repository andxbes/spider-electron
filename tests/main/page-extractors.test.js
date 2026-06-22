const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const {
    extractMetaRobotsRaw,
    collectResponseHeaders,
    getXRobotsTag,
} = require('../../src/main/page-extractors');

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

describe('page-extractors', () => {
    it('extractMetaRobotsRaw reads only HTML meta tags', () => {
        const $ = cheerio.load(
            '<html><head><meta name="robots" content="noindex"></head></html>'
        );
        assert.equal(extractMetaRobotsRaw($), 'noindex');
    });

    it('extractMetaRobotsRaw ignores X-Robots-Tag response header', () => {
        const $ = cheerio.load('<html><head></head></html>');
        const response = mockResponse({ 'x-robots-tag': 'nofollow' });
        assert.equal(extractMetaRobotsRaw($), '');
        assert.equal(getXRobotsTag(response), 'nofollow');
    });

    it('collectResponseHeaders returns sorted name/value pairs', () => {
        const response = mockResponse({
            'content-type': 'text/html',
            'x-robots-tag': 'noindex',
        });
        assert.deepEqual(collectResponseHeaders(response), [
            { name: 'content-type', value: 'text/html' },
            { name: 'x-robots-tag', value: 'noindex' },
        ]);
    });
});
