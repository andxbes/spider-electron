const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizePageUrl,
    getUrlExtension,
    getUrlPathnameLower,
    isSameHost,
    isSkippableHref,
    firstSrcsetUrl,
    looksLikeJavascriptUrl,
    isRedirectStatus,
    resolveRedirectTarget,
    getContentType,
    isHtmlContent,
} = require('../../src/shared/url-utils');

describe('url-utils', () => {
    it('normalizePageUrl strips hash', () => {
        assert.equal(
            normalizePageUrl('https://example.com/page#section'),
            'https://example.com/page'
        );
    });

    it('getUrlExtension parses extension', () => {
        assert.equal(getUrlExtension('https://x.com/app.js'), 'js');
        assert.equal(getUrlExtension('https://x.com/path'), '');
    });

    it('isSkippableHref rejects non-navigational schemes', () => {
        assert.equal(isSkippableHref('javascript:void(0)'), true);
        assert.equal(isSkippableHref('mailto:a@b.c'), true);
        assert.equal(isSkippableHref('/about'), false);
    });

    it('firstSrcsetUrl picks first candidate', () => {
        assert.equal(firstSrcsetUrl('a.webp 1x, b.webp 2x'), 'a.webp');
    });

    it('looksLikeJavascriptUrl detects js paths', () => {
        assert.equal(looksLikeJavascriptUrl('https://x.com/bundle.js', 'js', '/bundle.js'), true);
        assert.equal(looksLikeJavascriptUrl('https://x.com/app', '', '/app'), false);
    });

    it('isRedirectStatus covers 3xx', () => {
        assert.equal(isRedirectStatus(301), true);
        assert.equal(isRedirectStatus(200), false);
    });

    it('resolveRedirectTarget resolves relative Location', () => {
        assert.equal(
            resolveRedirectTarget('https://example.com/old', '/new'),
            'https://example.com/new'
        );
    });

    it('getContentType strips charset', () => {
        const response = { headers: { get: (k) => (k === 'content-type' ? 'text/html; charset=utf-8' : '') } };
        assert.equal(getContentType(response), 'text/html');
    });

    it('isHtmlContent treats empty as html', () => {
        assert.equal(isHtmlContent(''), true);
        assert.equal(isHtmlContent('application/json'), false);
    });

    it('isSameHost compares hostnames', () => {
        assert.equal(isSameHost('https://a.com/x', 'a.com'), true);
        assert.equal(isSameHost('https://b.com', 'a.com'), false);
    });

    it('getUrlPathnameLower lowercases pathname', () => {
        assert.equal(getUrlPathnameLower('https://X.com/Path'), '/path');
    });
});
