const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function loadExportCsv() {
    const root = { URL };
    const uiLogic = fs.readFileSync(path.join(__dirname, '../../src/renderer/ui-logic.js'), 'utf8');
    const exportCsv = fs.readFileSync(path.join(__dirname, '../../src/renderer/export-csv.js'), 'utf8');
    vm.runInNewContext(uiLogic, root);
    vm.runInNewContext(exportCsv, root);
    return root;
}

describe('export-csv page links', () => {
    it('urlToFileSlug keeps last path segment within 10 chars', () => {
        const api = loadExportCsv();
        assert.equal(api.PAGE_LINKS_SLUG_MAX_LENGTH, 10);
        assert.equal(api.urlToFileSlug('https://example.com/blog/post-1'), 'post-1');
        assert.equal(api.urlToFileSlug('https://example.com/img/hero.jpg?v=2'), 'hero.jpg');
        assert.equal(api.urlToFileSlug('https://example.com/super-long-banner-image.jpg'), 'super-long');
        assert.equal(api.urlToFileSlug('https://example.com/'), 'example.co');
    });

    it('findDisplayedRowIndex is 1-based in filtered order', () => {
        const api = loadExportCsv();
        const entries = [
            { url: 'https://example.com/a' },
            { url: 'https://example.com/img/hero.jpg' },
            { url: 'https://example.com/b' },
        ];
        assert.equal(api.findDisplayedRowIndex('https://example.com/img/hero.jpg', entries), 2);
        assert.equal(api.findDisplayedRowIndex('https://example.com/missing', entries), 0);
    });

    it('buildPageLinksCsvFileName uses short slug, row index, direction, filters and stamp', () => {
        const api = loadExportCsv();
        const stamp = new Date('2026-06-17T16:30:45.000Z');
        const fileName = api.buildPageLinksCsvFileName(
            'https://example.com/blog/post-1',
            'in',
            stamp,
            { rowIndex: 3, contentType: 'html', sourceFilter: 'internal' }
        );
        assert.equal(fileName, 'post-1-3-in-html-internal-2026-06-17-16-30-45.csv');
    });

    it('buildPageLinksCsvFileName defaults missing index and filters', () => {
        const api = loadExportCsv();
        const stamp = new Date('2026-06-17T16:30:45.000Z');
        const fileName = api.buildPageLinksCsvFileName(
            'https://example.com/img/hero.jpg?v=2',
            'in',
            stamp
        );
        assert.equal(fileName, 'hero.jpg-0-in-all-all-2026-06-17-16-30-45.csv');
    });

    it('linkToCsvRow puts source first and target last for inlinks', () => {
        const api = loadExportCsv();
        const targetUrl = 'https://example.com/img/hero.jpg?v=2';
        const row = api.linkToCsvRow({
            href: 'https://example.com/source',
            tag: 'a[href]',
            rel: 'nofollow',
            relFollowAllowed: false,
            text: 'Click me',
        }, 'in', targetUrl);
        assert.equal(
            row,
            '"https://example.com/source","a[href]","nofollow","Обмежено","Click me","https://example.com/img/hero.jpg?v=2"'
        );
    });

    it('buildPageLinksCsvRows puts target URL last in inlink header and rows', () => {
        const api = loadExportCsv();
        const pageUrl = 'https://example.com/about';
        const { csvRows } = api.buildPageLinksCsvRows({
            pageUrl,
            type: 'in',
            links: [{ href: 'https://example.com/', text: 'Home', tag: 'a[href]' }],
            sortState: { column: 'url', direction: 'asc' },
        });
        assert.equal(csvRows[0], 'Source URL,Tag,rel,Follow,Anchor Text,Target URL');
        assert.match(csvRows[1], /^"https:\/\/example\.com\/"/);
        assert.match(csvRows[1], /"https:\/\/example\.com\/about"$/);
    });

    it('exportPageLinksToCsv returns empty reason when no links', () => {
        const api = loadExportCsv();
        const result = api.exportPageLinksToCsv({
            pageUrl: 'https://example.com/',
            type: 'out',
            links: [],
            sortState: { column: 'url', direction: 'asc' },
            scanStartedAt: new Date('2026-06-17T16:30:45.000Z'),
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'empty');
    });
});
