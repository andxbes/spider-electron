const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function loadDetailPanel() {
    const root = {
        URL,
        console,
        Map,
        Set,
        document: {
            querySelectorAll: () => [],
        },
    };
    root.globalThis = root;
    root.window = root;
    const files = [
        path.join(__dirname, '../../src/shared/hook-registry.js'),
        path.join(__dirname, '../../src/renderer/ui-logic.js'),
        path.join(__dirname, '../../src/renderer/ui-hooks.js'),
        path.join(__dirname, '../../src/renderer/detail-panel.js'),
    ];
    const sandbox = vm.createContext(root);
    for (const file of files) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
    }
    return sandbox;
}

function clickLinkRow(listeners, url) {
    listeners.click({
        target: {
            closest(selector) {
                if (selector === '.sortable-link-th') {
                    return null;
                }
                if (selector === '.detail-links-table tbody tr[data-url]') {
                    return {
                        dataset: { url },
                        classList: { toggle() {} },
                        focus() {},
                    };
                }
                return null;
            },
        },
    });
}

function createPanel() {
    const api = loadDetailPanel();
    let selectedUrl = 'https://example.com/page';
    let activeTab = 'outlinks';
    const listeners = {};
    const detailContent = {
        innerHTML: '',
        addEventListener(type, handler) {
            listeners[type] = handler;
        },
        querySelectorAll: () => [],
    };
    const panel = api.createDetailPanel({
        detailContent,
        getSelectedUrl: () => selectedUrl,
        getRowData: () => ({ url: selectedUrl, status: 200 }),
        getActiveTab: () => activeTab,
        setActiveTab: (tab) => { activeTab = tab; },
        getReferrersForUrl: () => [
            { href: 'https://example.com/in-a', text: 'in a', tag: 'a' },
            { href: 'https://example.com/in-b', text: 'in b', tag: 'a' },
        ],
        getOutgoingLinksFrom: () => [
            { url: 'https://example.com/out-a', text: 'out a', tag: 'a' },
            { url: 'https://example.com/out-b', text: 'out b', tag: 'img[src]' },
            { url: 'https://other.test/ext', text: 'ext', tag: 'a', external: true },
        ],
        getFilteredOutgoingLinks: () => [
            { url: 'https://example.com/out-a', text: 'out a', tag: 'a' },
            { url: 'https://example.com/out-b', text: 'out b', tag: 'img[src]' },
            { url: 'https://other.test/ext', text: 'ext', tag: 'a', external: true },
        ],
        urlCellHtml: (url) => `<span>${url}</span>`,
        getLinkTableSortState: () => ({ column: 'url', direction: 'asc' }),
        setLinkTableSortState() {},
        getDetailHelpers: () => ({}),
        hasActiveLinkFilters: () => false,
    });
    panel.bindTabs();
    return {
        panel,
        detailContent,
        listeners,
        setTab: (tab) => { activeTab = tab; },
        setSelectedUrl: (url) => { selectedUrl = url; },
    };
}

function focusedRowUrl(html) {
    const match = html.match(/<tr class="[^"]*detail-link-focused[^"]*" data-url="([^"]+)"/);
    return match ? match[1] : null;
}

describe('detail panel focused link', () => {
    it('does not highlight a row until one is focused', () => {
        const { panel, detailContent } = createPanel();
        panel.renderDetailPanel();
        assert.equal(focusedRowUrl(detailContent.innerHTML), null);
        assert.match(detailContent.innerHTML, /data-url="https:\/\/example.com\/out-b"/);
    });

    it('keeps the focused outgoing row after re-render', () => {
        const { panel, detailContent, listeners } = createPanel();
        panel.renderDetailPanel();
        clickLinkRow(listeners, 'https://example.com/out-b');
        panel.renderDetailPanel();
        assert.equal(focusedRowUrl(detailContent.innerHTML), 'https://example.com/out-b');
    });

    it('stores focus separately for inlinks and outlinks', () => {
        const { panel, detailContent, listeners, setTab } = createPanel();
        panel.renderDetailPanel();
        clickLinkRow(listeners, 'https://example.com/out-b');

        setTab('inlinks');
        panel.renderDetailPanel();
        clickLinkRow(listeners, 'https://example.com/in-a');
        panel.renderDetailPanel();
        assert.equal(focusedRowUrl(detailContent.innerHTML), 'https://example.com/in-a');

        setTab('outlinks');
        panel.renderDetailPanel();
        assert.equal(focusedRowUrl(detailContent.innerHTML), 'https://example.com/out-b');
    });

    it('marks external rows without treating them as focused', () => {
        const { panel, detailContent } = createPanel();
        panel.renderDetailPanel();
        assert.match(detailContent.innerHTML, /detail-link-external[^>]*data-url="https:\/\/other.test\/ext"|data-url="https:\/\/other.test\/ext"[^>]*detail-link-external/);
        assert.equal(focusedRowUrl(detailContent.innerHTML), null);
    });
});
