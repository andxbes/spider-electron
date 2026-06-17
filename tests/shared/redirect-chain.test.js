const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_REDIRECT_HOPS,
    createRedirectChainTracker,
    findFirstRepeatedUrl,
    hasRedirectChainData,
    hasMultipleRedirects,
    redirectHopCountSortValue,
    formatRedirectCellLabel,
    formatRedirectChainTooltip,
} = require('../../src/shared/redirect-chain');

describe('redirect-chain', () => {
    it('MAX_REDIRECT_HOPS is 20', () => {
        assert.equal(MAX_REDIRECT_HOPS, 20);
    });

    it('findFirstRepeatedUrl detects loop start', () => {
        assert.equal(
            findFirstRepeatedUrl(['https://a', 'https://b', 'https://a']),
            'https://a',
        );
    });

    it('createRedirectChainTracker records hops and final url', () => {
        const tracker = createRedirectChainTracker('https://example.com/a');
        tracker.recordHop({
            from: 'https://example.com/a',
            to: 'https://example.com/b',
            status: 301,
            responseTimeMs: 12,
        });
        tracker.recordHop({
            from: 'https://example.com/b',
            to: 'https://example.com/c',
            status: 302,
            responseTimeMs: 8,
        });
        const fields = tracker.toFields();
        assert.equal(fields.redirectHopCount, 2);
        assert.equal(fields.redirectFinalUrl, 'https://example.com/c');
        assert.deepEqual(fields.redirectChain, [
            'https://example.com/a',
            'https://example.com/b',
            'https://example.com/c',
        ]);
        assert.equal(fields.redirectUrl, 'https://example.com/b');
    });

    it('marks infinite redirect chains', () => {
        const tracker = createRedirectChainTracker('https://example.com/a');
        tracker.recordHop({
            from: 'https://example.com/a',
            to: 'https://example.com/b',
            status: 301,
            responseTimeMs: 5,
        });
        tracker.markInfinite('https://example.com/a');
        const fields = tracker.toFields();
        assert.equal(fields.redirectInfinite, true);
        assert.equal(fields.redirectLoopStartUrl, 'https://example.com/a');
        assert.equal(formatRedirectCellLabel(fields), '∞ 1+');
    });

    it('hasMultipleRedirects is true for two or more hops', () => {
        assert.equal(hasMultipleRedirects({ redirectHopCount: 1 }), false);
        assert.equal(hasMultipleRedirects({ redirectHopCount: 2 }), true);
    });

    it('redirectHopCountSortValue ranks infinite chains higher', () => {
        assert.ok(redirectHopCountSortValue({ redirectInfinite: true, redirectHopCount: 3 })
            > redirectHopCountSortValue({ redirectHopCount: 3 }));
    });

    it('formatRedirectChainTooltip includes loop warning', () => {
        const tooltip = formatRedirectChainTooltip({
            redirectChain: ['https://a', 'https://b'],
            redirectFinalUrl: 'https://b',
            redirectInfinite: true,
            redirectLoopStartUrl: 'https://a',
        });
        assert.match(tooltip, /Перше повторення: https:\/\/a/);
        assert.match(tooltip, /Цикл/);
    });

    it('hasRedirectChainData detects redirect metadata', () => {
        assert.equal(hasRedirectChainData({ redirectHopCount: 0 }), false);
        assert.equal(hasRedirectChainData({ redirectHopCount: 1 }), true);
        assert.equal(hasRedirectChainData({ redirectInfinite: true }), true);
    });
});
