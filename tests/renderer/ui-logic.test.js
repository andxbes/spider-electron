const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    escapeHtml,
    statusSortValue,
    parseLinkRel,
    inferLinkKind,
    matchesStatusFilter,
    isIndexingAllowed,
    rowHasEmptyImgSrc,
    rowHasBrokenImage,
    rowHasExternalFollowAnchor,
    resolveIssueFilter,
    passesTableFiltersImpl,
    normalizeContentTypeFilter,
    normalizeSourceFilter,
    getResourceKind,
    matchesResourceTypeFilterImpl,
    formatDisplayUrl,
    EMPTY_IMAGE_URL,
    EMPTY_IMAGE_LABEL,
    formatCsvUrlListPreview,
    compareRowsImpl,
    duplicateCountBadge,
    buildH1DuplicateCounts,
    linkTableSortIndicator,
    getTableViewProfile,
    applyTableViewProfile,
    imageAltCellHtml,
    imageAltSortValue,
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

    it('parseLinkRel keeps noopener as follow-allowed', () => {
        assert.equal(parseLinkRel('noopener').relFollowAllowed, true);
        assert.equal(parseLinkRel('noopener noreferrer').relFollowAllowed, true);
        assert.equal(parseLinkRel('nofollow noopener').relFollowAllowed, false);
    });

    it('inferLinkKind uses tag for scripts', () => {
        assert.equal(inferLinkKind({ tag: 'script[src]', url: 'https://x.com/a' }), 'javascript');
    });

    it('broken img[src] with HTML 404 stays in Media, not HTML', () => {
        const row = {
            url: 'https://lh7-us.googleusercontent.com/abc',
            tag: 'img[src]',
            kind: 'images',
            status: 404,
            contentType: 'text/html',
            fetched: true,
        };
        assert.equal(matchesResourceTypeFilterImpl(row, 'media'), true);
        assert.equal(matchesResourceTypeFilterImpl(row, 'html'), false);
        assert.equal(getResourceKind(row), 'media');
    });

    it('empty img sentinel is media and displays as немає адреси', () => {
        const row = {
            url: EMPTY_IMAGE_URL,
            tag: 'img',
            kind: 'images',
            emptySrc: true,
            fetched: false,
            status: '',
            external: false,
        };
        assert.equal(formatDisplayUrl(EMPTY_IMAGE_URL), EMPTY_IMAGE_LABEL);
        assert.equal(matchesResourceTypeFilterImpl(row, 'media'), true);
        assert.equal(matchesResourceTypeFilterImpl(row, 'html'), false);
        assert.equal(getResourceKind(row), 'media');
        assert.equal(rowHasEmptyImgSrc(row), true);
    });

    it('passesTableFiltersImpl empty-src issue keeps pages with empty imgs', () => {
        const page = {
            url: 'https://example.com/about',
            status: 200,
            contentType: 'text/html',
            fetched: true,
            emptyImgCount: 2,
            metaRobotsStatus: 'allowed',
            robotsAllowed: true,
            headings: [],
        };
        const ok = {
            url: 'https://example.com/ok',
            status: 200,
            contentType: 'text/html',
            fetched: true,
            emptyImgCount: 0,
            metaRobotsStatus: 'allowed',
            robotsAllowed: true,
            headings: [],
        };
        const ctx = {
            activeIssueFilter: 'empty-src',
            getDuplicateCounts: () => ({ h1: new Map(), title: new Map(), description: new Map() }),
        };
        assert.equal(passesTableFiltersImpl(page, ctx), true);
        assert.equal(passesTableFiltersImpl(ok, ctx), false);
    });

    it('passesTableFiltersImpl empty-src also keeps 404 images', () => {
        const brokenImg = {
            url: 'https://lh7-us.googleusercontent.com/abc',
            tag: 'img[src]',
            kind: 'images',
            status: 404,
            contentType: 'text/html',
            fetched: true,
        };
        const okImg = {
            url: 'https://example.com/logo.png',
            tag: 'img[src]',
            kind: 'images',
            status: 200,
            contentType: 'image/png',
            fetched: true,
        };
        const missingPage = {
            url: 'https://example.com/gone',
            tag: 'a[href]',
            status: 404,
            contentType: 'text/html',
            fetched: true,
            headings: [],
        };
        const video404 = {
            url: 'https://example.com/clip.mp4',
            tag: 'video[src]',
            kind: 'media',
            status: 404,
            fetched: true,
        };
        const pageWithBrokenImg = {
            url: 'https://example.com/gallery',
            status: 200,
            contentType: 'text/html',
            fetched: true,
            emptyImgCount: 0,
            headings: [],
        };
        const ctx = {
            activeIssueFilter: 'empty-src',
            getDuplicateCounts: () => ({ h1: new Map(), title: new Map(), description: new Map() }),
            getOutgoingLinksFrom: (url) => (url === pageWithBrokenImg.url ? [brokenImg] : []),
        };
        assert.equal(rowHasBrokenImage(brokenImg), true);
        assert.equal(rowHasBrokenImage(okImg), false);
        assert.equal(passesTableFiltersImpl(brokenImg, ctx), true);
        assert.equal(passesTableFiltersImpl(okImg, ctx), false);
        assert.equal(passesTableFiltersImpl(missingPage, ctx), false);
        assert.equal(passesTableFiltersImpl(video404, ctx), false);
        assert.equal(passesTableFiltersImpl(pageWithBrokenImg, ctx), true);
    });

    it('passesTableFiltersImpl ext-a-follow keeps pages and targets without nofollow', () => {
        const followed = {
            url: 'https://other.com/promo',
            tag: 'a[href]',
            external: true,
            rel: 'noopener',
            relFollowAllowed: true,
            status: 200,
            fetched: true,
        };
        const nofollow = {
            url: 'https://other.com/ads',
            tag: 'a[href]',
            external: true,
            rel: 'nofollow',
            relFollowAllowed: false,
            status: 200,
            fetched: true,
        };
        const sponsored = {
            url: 'https://other.com/paid',
            tag: 'a[href]',
            external: true,
            rel: 'sponsored',
            relFollowAllowed: false,
            status: 200,
            fetched: true,
        };
        const imgExternal = {
            url: 'https://cdn.other.com/logo.png',
            tag: 'img[src]',
            external: true,
            relFollowAllowed: true,
            status: 200,
            fetched: true,
        };
        const page = {
            url: 'https://example.com/links',
            status: 200,
            contentType: 'text/html',
            fetched: true,
            external: false,
            headings: [],
        };
        const cleanPage = {
            url: 'https://example.com/clean',
            status: 200,
            contentType: 'text/html',
            fetched: true,
            external: false,
            headings: [],
        };
        const outgoingByPage = {
            [page.url]: [followed, nofollow, imgExternal],
            [cleanPage.url]: [nofollow, sponsored],
        };
        const referrersByUrl = {
            [followed.url]: [{
                href: page.url,
                tag: 'a[href]',
                rel: 'noopener',
                relFollowAllowed: true,
            }],
            [nofollow.url]: [{
                href: page.url,
                tag: 'a[href]',
                rel: 'nofollow',
                relFollowAllowed: false,
            }],
        };
        const ctx = {
            activeIssueFilter: 'ext-a-follow',
            scanHostname: 'example.com',
            getDuplicateCounts: () => ({ h1: new Map(), title: new Map(), description: new Map() }),
            getOutgoingLinksFrom: (url) => outgoingByPage[url] || [],
            getReferrersForUrl: (url) => referrersByUrl[url] || [],
        };
        assert.equal(rowHasExternalFollowAnchor(page, ctx), true);
        assert.equal(rowHasExternalFollowAnchor(cleanPage, ctx), false);
        assert.equal(passesTableFiltersImpl(page, ctx), true);
        assert.equal(passesTableFiltersImpl(cleanPage, ctx), false);
        assert.equal(passesTableFiltersImpl(followed, ctx), true);
        assert.equal(passesTableFiltersImpl(nofollow, ctx), false);
        assert.equal(passesTableFiltersImpl(sponsored, ctx), false);
        assert.equal(passesTableFiltersImpl(imgExternal, ctx), false);
        assert.equal(resolveIssueFilter({ issue: 'external-nofollow' }), 'ext-a-follow');
    });

    it('passesTableFiltersImpl issue h1-multiple and dup-title', () => {
        const multiH1 = {
            url: 'https://example.com/a',
            status: 200,
            fetched: true,
            headings: [{ level: 1, text: 'One' }, { level: 1, text: 'Two' }],
            title: 'About',
        };
        const single = {
            url: 'https://example.com/b',
            status: 200,
            fetched: true,
            headings: [{ level: 1, text: 'One' }],
            title: 'Home',
        };
        const counts = {
            h1: new Map(),
            title: new Map([['about', 2]]),
            description: new Map(),
        };
        const ctx = {
            getDuplicateCounts: () => counts,
        };
        assert.equal(passesTableFiltersImpl(multiH1, { ...ctx, activeIssueFilter: 'h1-multiple' }), true);
        assert.equal(passesTableFiltersImpl(single, { ...ctx, activeIssueFilter: 'h1-multiple' }), false);
        assert.equal(passesTableFiltersImpl(multiH1, { ...ctx, activeIssueFilter: 'dup-title' }), true);
        assert.equal(passesTableFiltersImpl(single, { ...ctx, activeIssueFilter: 'dup-title' }), false);
        assert.equal(resolveIssueFilter({ h1: 'multiple' }), 'h1-multiple');
        assert.equal(resolveIssueFilter({ duplicate: 'title' }), 'dup-title');
    });

    it('real HTML page still matches HTML tab', () => {
        const row = {
            url: 'https://example.com/about',
            tag: 'a[href]',
            status: 200,
            contentType: 'text/html',
            fetched: true,
        };
        assert.equal(matchesResourceTypeFilterImpl(row, 'html'), true);
        assert.equal(matchesResourceTypeFilterImpl(row, 'media'), false);
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
            activeIssueFilter: 'all',
            activeContentFilter: 'all',
            scanHostname: 'example.com',
            getDuplicateCounts: () => ({ h1: new Map(), title: new Map(), description: new Map() }),
            getReferrersForUrl: () => [],
        };
        assert.equal(passesTableFiltersImpl(row, ctx), true);
        assert.equal(passesTableFiltersImpl(row, { ...ctx, activeSearchQuery: 'missing' }), false);
    });

    it('applyTableViewProfile adjusts columns per content tab', () => {
        const baseColumns = [
            { id: 'url' },
            { id: 'status' },
            { id: 'contentType' },
            { id: 'h1' },
            { id: 'title' },
            { id: 'metaDescription' },
            { id: 'ogTitle' },
        ];
        assert.equal(getTableViewProfile('all'), 'full');
        assert.equal(getTableViewProfile('media'), 'images');
        assert.equal(getTableViewProfile('javascript'), 'asset');

        const full = applyTableViewProfile(baseColumns, 'full');
        assert.equal(full.length, baseColumns.length);

        const images = applyTableViewProfile(baseColumns, 'images', { getReferrersForUrl: () => [] });
        assert.ok(images.some((col) => col.id === 'alt'));
        assert.ok(!images.some((col) => col.id === 'contentType'));
        assert.ok(!images.some((col) => col.id === 'title'));

        const asset = applyTableViewProfile(baseColumns, 'asset');
        assert.ok(asset.some((col) => col.id === 'contentType'));
        assert.ok(!asset.some((col) => col.id === 'h1'));
        assert.ok(!asset.some((col) => col.id === 'ogTitle'));
    });

    it('imageAltCellHtml shows missing and empty alt states', () => {
        const html = imageAltCellHtml(
            { url: 'https://example.com/a.png' },
            () => [{ tag: 'img[src]', imgAlt: '' }]
        );
        assert.match(html, /порожній/);

        const missing = imageAltCellHtml(
            { url: 'https://example.com/b.png' },
            () => [{ tag: 'img[srcset]', imgAltMissing: true }]
        );
        assert.match(missing, /немає/);

        const rowMissing = imageAltCellHtml(
            {
                url: 'https://example.com/c.png',
                tag: 'img[src]',
                text: 'image',
                imgAltMissing: true,
            },
            () => []
        );
        assert.match(rowMissing, /немає/);
    });

    it('imageAltSortValue orders missing, mixes, empty, then alphabetical', () => {
        const missingOnly = {
            url: 'https://example.com/missing.png',
            tag: 'img[src]',
            imgAltMissing: true,
        };
        const missingMix = {
            url: 'https://example.com/missing-mix.png',
        };
        const emptyOnly = {
            url: 'https://example.com/empty.png',
        };
        const emptyMix = {
            url: 'https://example.com/empty-mix.png',
        };
        const alphaB = {
            url: 'https://example.com/b.png',
        };
        const alphaA = {
            url: 'https://example.com/a.png',
        };
        const none = {
            url: 'https://example.com/none.png',
        };
        const getReferrers = (url) => {
            if (url === missingMix.url) {
                return [
                    { tag: 'img[src]', imgAltMissing: true },
                    { tag: 'img[srcset]', imgAlt: 'Caption' },
                ];
            }
            if (url === emptyOnly.url) {
                return [{ tag: 'img[src]', imgAlt: '' }];
            }
            if (url === emptyMix.url) {
                return [
                    { tag: 'img[src]', imgAlt: '' },
                    { tag: 'img[srcset]', imgAlt: 'Label' },
                ];
            }
            if (url === alphaB.url) {
                return [{ tag: 'img[src]', imgAlt: 'Beta' }];
            }
            if (url === alphaA.url) {
                return [{ tag: 'img[src]', imgAlt: 'Alpha' }];
            }
            return [];
        };

        assert.equal(imageAltSortValue(missingOnly, getReferrers), '0');
        assert.equal(imageAltSortValue(missingMix, getReferrers), '1');
        assert.equal(imageAltSortValue(emptyOnly, getReferrers), '2');
        assert.equal(imageAltSortValue(emptyMix, getReferrers), '3');
        assert.equal(imageAltSortValue(alphaA, getReferrers), '4:alpha');
        assert.equal(imageAltSortValue(alphaB, getReferrers), '4:beta');
        assert.equal(imageAltSortValue(none, getReferrers), '0');

        const rows = [alphaB, none, emptyMix, missingMix, emptyOnly, missingOnly, alphaA];
        const sorted = [...rows].sort((a, b) => compareRowsImpl(
            a,
            b,
            { column: 'alt', direction: 'asc' },
            [],
            { getReferrersForUrl: getReferrers }
        ));
        assert.deepEqual(
            sorted.map((row) => row.url),
            [
                missingOnly.url,
                none.url,
                missingMix.url,
                emptyOnly.url,
                emptyMix.url,
                alphaA.url,
                alphaB.url,
            ]
        );
    });

    it('legacy img referrer without imgAltMissing sorts as missing not empty', () => {
        const row = { url: 'https://example.com/logo.png' };
        const getReferrers = () => ([{ tag: 'img[src]', text: 'image' }]);
        assert.equal(imageAltSortValue(row, getReferrers), '0');
        const html = imageAltCellHtml(row, getReferrers);
        assert.match(html, /немає/);
        assert.doesNotMatch(html, /порожній/);
    });

    it('compareRowsImpl alt sort uses referrers when row has no imgAlt fields', () => {
        const missing = {
            url: 'https://example.com/missing.png',
            contentType: 'image/png',
        };
        const empty = {
            url: 'https://example.com/empty.png',
            contentType: 'image/png',
        };
        const getReferrers = (url) => {
            if (url === missing.url) {
                return [{ tag: 'img[src]', imgAltMissing: true }];
            }
            if (url === empty.url) {
                return [{ tag: 'img[src]', imgAlt: '' }];
            }
            return [];
        };
        assert.equal(imageAltSortValue(missing, getReferrers), '0');
        assert.equal(imageAltSortValue(empty, getReferrers), '2');
        assert.equal(
            compareRowsImpl(
                empty,
                missing,
                { column: 'alt', direction: 'asc' },
                [],
                { getReferrersForUrl: getReferrers },
            ),
            2
        );
    });

    it('compareImageAltSortImpl treats mixed alt states from one referrer as missing mix', () => {
        const mixed = { url: 'https://example.com/mixed.png' };
        const getReferrers = () => ([
            {
                href: 'https://example.com/page',
                tag: 'img[src]',
                imgAltMissing: true,
                imgAlt: 'Logo',
                imgAltStates: [
                    { tag: 'img[src]', imgAltMissing: true },
                    { tag: 'img[src]', imgAlt: 'Logo' },
                ],
            },
        ]);
        assert.equal(imageAltSortValue(mixed, getReferrers), '1');
    });

    it('compareImageAltSortImpl puts dash rows before text alt', () => {
        const latin = { url: 'https://example.com/latin.png' };
        const cyrillic = { url: 'https://example.com/cyrillic.png' };
        const none = { url: 'https://example.com/none.png' };
        const getReferrers = (url) => {
            if (url === latin.url) {
                return [{ tag: 'img[src]', imgAlt: 'Zulu' }];
            }
            if (url === cyrillic.url) {
                return [{ tag: 'img[src]', imgAlt: 'Яблуко' }];
            }
            return [];
        };

        const rows = [none, cyrillic, latin];
        const sorted = [...rows].sort((a, b) => compareRowsImpl(
            a,
            b,
            { column: 'alt', direction: 'asc' },
            [],
            { getReferrersForUrl: getReferrers },
        ));
        assert.deepEqual(
            sorted.map((row) => row.url),
            [none.url, cyrillic.url, latin.url],
        );
        assert.equal(sorted[0].url, none.url);
        assert.equal(imageAltSortValue(none, getReferrers), '0');
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

    it('compareRowsImpl sorts by inCount using row metrics', () => {
        const rows = [
            { url: 'https://b' },
            { url: 'https://a' },
            { url: 'https://c' },
        ];
        const helpers = {
            getRowMetrics: (data) => ({
                inCount: data.url === 'https://a' ? 0 : (data.url === 'https://b' ? 3 : 1),
                linkCount: 0,
                internalCount: 0,
                externalCount: 0,
            }),
        };
        rows.sort((a, b) => compareRowsImpl(
            a,
            b,
            { column: 'inCount', direction: 'asc' },
            [],
            helpers,
        ));
        assert.deepEqual(rows.map((row) => row.url), ['https://a', 'https://c', 'https://b']);
    });

    it('compareRowsImpl sorts by responseTimeMs', () => {
        const rows = [
            { url: 'https://slow', responseTimeMs: 900 },
            { url: 'https://fast', responseTimeMs: 120 },
        ];
        rows.sort((a, b) => compareRowsImpl(a, b, { column: 'responseTimeMs', direction: 'asc' }, []));
        assert.equal(rows[0].url, 'https://fast');
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
