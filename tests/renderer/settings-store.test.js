const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeDumpSettings,
    setSessionSitemapUrlsText,
    getSessionSitemapUrlsText,
    DEFAULT_SETTINGS,
} = require('../../src/renderer/settings-store');

describe('settings-store dump settings', () => {
    beforeEach(() => {
        setSessionSitemapUrlsText('');
    });

    it('normalizeDumpSettings merges defaults and sitemap text', () => {
        const normalized = normalizeDumpSettings({
            useSitemap: true,
            concurrency: 7,
            sitemapUrlsText: 'https://example.com/s.xml\n/other.xml',
        });
        assert.equal(normalized.useSitemap, true);
        assert.equal(normalized.concurrency, 7);
        assert.equal(normalized.respectRobotsTxt, DEFAULT_SETTINGS.respectRobotsTxt);
        assert.equal(
            normalized.sitemapUrlsText,
            'https://example.com/s.xml\n/other.xml'
        );
    });

    it('normalizeDumpSettings accepts sitemapUrls array', () => {
        const normalized = normalizeDumpSettings({
            sitemapUrls: ['https://a/s.xml', '', '/b.xml'],
        });
        assert.equal(normalized.sitemapUrlsText, 'https://a/s.xml\n/b.xml');
    });

    it('normalizeDumpSettings returns null for invalid input', () => {
        assert.equal(normalizeDumpSettings(null), null);
        assert.equal(normalizeDumpSettings('x'), null);
    });

    it('session sitemap text round-trips', () => {
        setSessionSitemapUrlsText('/custom.xml');
        assert.equal(getSessionSitemapUrlsText(), '/custom.xml');
    });
});
