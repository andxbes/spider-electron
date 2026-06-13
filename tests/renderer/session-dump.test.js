const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    cloneResultEntry,
    buildSessionDumpPayload,
    normalizeLoadedDump,
    buildWorkspaceSnapshot,
} = require('../../src/renderer/session-dump');

describe('session-dump renderer', () => {
    it('cloneResultEntry normalizes referrers and fetched flag', () => {
        const entry = cloneResultEntry({
            url: 'https://example.com',
            status: 200,
            referrers: ['https://parent'],
        });
        assert.equal(entry.fetched, true);
        assert.deepEqual(entry.referrers[0], { href: 'https://parent', text: '' });
    });

    it('buildSessionDumpPayload preserves insertion order', () => {
        const scanResults = new Map([
            ['https://b', { url: 'https://b', status: 200 }],
            ['https://a', { url: 'https://a', status: 200 }],
        ]);
        const payload = buildSessionDumpPayload({
            scanResults,
            insertionOrder: ['https://a', 'https://b'],
            startUrl: 'https://a',
            uiState: 'idle',
            lastScanProgress: null,
        });
        assert.equal(payload.results[0].url, 'https://a');
        assert.equal(payload.resultCount, 2);
    });

    it('normalizeLoadedDump rebuilds insertion order from results', () => {
        const normalized = normalizeLoadedDump({
            version: 1,
            startUrl: 'https://example.com',
            results: [{ url: 'https://example.com/x', status: 200 }],
        });
        assert.deepEqual(normalized.insertionOrder, ['https://example.com/x']);
    });

    it('buildWorkspaceSnapshot stores filters', () => {
        const scanResults = new Map([['https://x', { url: 'https://x', status: 200 }]]);
        const snapshot = buildWorkspaceSnapshot({
            scanResults,
            insertionOrder: ['https://x'],
            startUrl: 'https://x',
            lastScanProgress: { scanned: 1 },
            selectedUrl: 'https://x',
            statusHint: 'ok',
            filters: { content: 'html' },
        });
        assert.equal(snapshot.filters.content, 'html');
        assert.equal(snapshot.selectedUrl, 'https://x');
    });
});
