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
    it('buildPageLinksCsvFileName uses url slug, direction and scan stamp', () => {
        const api = loadExportCsv();
        const stamp = new Date('2026-06-17T16:30:45.000Z');
        const fileName = api.buildPageLinksCsvFileName(
            'https://example.com/blog/post-1',
            'in',
            stamp
        );
        assert.equal(fileName, 'example.com_blog_post-1-in-2026-06-17-16-30-45.csv');
    });

    it('linkToCsvRow exports full inlink fields', () => {
        const api = loadExportCsv();
        const row = api.linkToCsvRow({
            href: 'https://example.com/source',
            tag: 'a[href]',
            rel: 'nofollow',
            relFollowAllowed: false,
            text: 'Click me',
        }, 'in');
        assert.match(row, /"https:\/\/example\.com\/source"/);
        assert.match(row, /"nofollow"/);
        assert.match(row, /"Обмежено"/);
        assert.match(row, /"Click me"/);
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
