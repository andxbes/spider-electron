const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    escapeHtml,
    statusSortValue,
    parseLinkRel,
    inferLinkKind,
    matchesStatusFilter,
    isIndexingAllowed,
    passesTableFiltersImpl,
    normalizeContentTypeFilter,
    normalizeSourceFilter,
    getResourceKind,
    formatCsvUrlListPreview,
    compareRowsImpl,
    duplicateCountBadge,
    buildH1DuplicateCounts,
    linkTableSortIndicator,
} = require('../../src/renderer/ui-logic');

describe('ui-logic', () => {
    it('escapeHtml escapes special characters', () => {
        assert.equal(escapeHtml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
    });

    it('statusSortValue orders errors after numbers', () => {
        assert.ok(statusSortValue('ERROR') > statusSortValue(500));
        assert.ok(statusSortValue('SKIPPED') > statusSortValue(404));
    });

    it('parseLinkRel treats ugc as restricted', () => {
        assert.equal(parseLinkRel('ugc').relFollowAllowed, false);
    });

    it('inferLinkKind uses tag for scripts', () => {
        assert.equal(inferLinkKind({ tag: 'script[src]', url: 'https://x.com/a' }), 'javascript');
    });

    it('matchesStatusFilter supports groups and exact codes', () => {
        assert.equal(matchesStatusFilter(200, '2xx'), true);
        assert.equal(matchesStatusFilter(404, '2xx'), false);
        assert.equal(matchesStatusFilter(404, '404'), true);
    });

    it('isIndexingAllowed requires robots and meta allowed', () => {
        assert.equal(isIndexingAllowed({
            robotsAllowed: true,
            metaRobotsStatus: 'allowed',
        }), true);
        assert.equal(isIndexingAllowed({
            robotsAllowed: true,
            metaRobotsStatus: 'noindex',
        }), false);
    });

    it('passesTableFiltersImpl applies search and status filters', () => {
        const row = {
            url: 'https://example.com/about',
            status: 200,
            contentType: 'text/html',
            title: 'About us',
            fetched: true,
            metaRobotsStatus: 'allowed',
            robotsAllowed: true,
            headings: [],
        };
        const ctx = {
            activeSearchQuery: 'about',
            activeSourceFilter: 'all',
            activeStatusFilter: '2xx',
            activeIndexingFilter: 'all',
            activeH1Filter: 'all',
            activeDuplicateFilter: 'all',
            activeContentFilter: 'all',
            scanHostname: 'example.com',
            getDuplicateCounts: () => ({ h1: new Map(), title: new Map(), description: new Map() }),
            getReferrersForUrl: () => [],
        };
        assert.equal(passesTableFiltersImpl(row, ctx), true);
        assert.equal(passesTableFiltersImpl(row, { ...ctx, activeSearchQuery: 'missing' }), false);
    });

    it('normalizeContentTypeFilter maps legacy values', () => {
        assert.equal(normalizeContentTypeFilter('images'), 'media');
        assert.equal(normalizeSourceFilter('links-external'), 'external');
    });

    it('getResourceKind classifies javascript assets', () => {
        const kind = getResourceKind({
            url: 'https://x.com/app.js',
            tag: 'script[src]',
            fetched: false,
        });
        assert.equal(kind, 'javascript');
    });

    it('formatCsvUrlListPreview truncates with total count', () => {
        const items = Array.from({ length: 12 }, (_, i) => `https://x.com/${i}`);
        const preview = formatCsvUrlListPreview(items, 3);
        assert.match(preview, /\(12\)$/);
    });

    it('compareRowsImpl sorts by status', () => {
        const rows = [
            { url: 'https://b', status: 404 },
            { url: 'https://a', status: 200 },
        ];
        rows.sort((a, b) => compareRowsImpl(a, b, { column: 'status', direction: 'asc' }, ['https://a', 'https://b']));
        assert.equal(rows[0].status, 200);
    });

    it('duplicateCountBadge hidden for single occurrence', () => {
        assert.equal(duplicateCountBadge(1), '');
        assert.match(duplicateCountBadge(3), /×3/);
    });

    it('buildH1DuplicateCounts counts entries without external scanResults', () => {
        const entries = [
            { headings: [{ level: 1, text: 'Same' }] },
            { headings: [{ level: 1, text: 'Same' }] },
        ];
        const counts = buildH1DuplicateCounts(entries);
        assert.equal(counts.get('same'), 2);
    });

    it('linkTableSortIndicator uses explicit sort state', () => {
        assert.equal(linkTableSortIndicator('url', 'URL', { column: 'url', direction: 'desc' }), 'URL ▼');
        assert.equal(linkTableSortIndicator('tag', 'Тег', { column: 'url', direction: 'desc' }), 'Тег');
    });
});
