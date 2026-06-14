const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function loadRendererScripts() {
    function makeEl(id) {
        return {
            id,
            value: '',
            textContent: '',
            innerHTML: '',
            disabled: false,
            hidden: false,
            classList: { add() {}, remove() {}, toggle() {} },
            style: {},
            options: [],
            appendChild(child) {
                if (child?.outerHTML) {
                    this.innerHTML += child.outerHTML;
                } else if (child?.innerHTML) {
                    this.innerHTML += child.innerHTML;
                }
            },
            querySelectorAll: () => [],
            addEventListener() {},
            dataset: {},
            setAttribute() {},
            focus() {},
            offsetHeight: 0,
            firstChild: null,
            insertBefore() {},
            getBoundingClientRect: () => ({
                height: 600,
                width: 800,
                top: 0,
                clientHeight: 400,
                scrollTop: 0,
                scrollHeight: 1000,
            }),
        };
    }

    const elements = {};
    const doc = {
        getElementById: (id) => elements[id] || (elements[id] = makeEl(id)),
        querySelector: (sel) => (sel === 'main' ? makeEl('main') : null),
        querySelectorAll: () => [],
        createElement: (tag) => {
            const el = {
                tagName: tag.toUpperCase(),
                ...makeEl(tag),
                innerHTML: '',
                outerHTML: '',
                appendChild(c) {
                    if (c.outerHTML) {
                        this.innerHTML += c.outerHTML;
                    } else if (c.innerHTML) {
                        this.innerHTML += c.innerHTML;
                    }
                },
                click() {},
            };
            return el;
        },
        addEventListener: () => {},
        body: { classList: { add() {}, remove() {} } },
    };

    const ctx = {
        document: doc,
        console,
        Map,
        Set,
        URL,
        Blob: class Blob {
            constructor(parts) {
                this.parts = parts;
            }
        },
        requestAnimationFrame: (fn) => fn(),
        cancelAnimationFrame: () => {},
        setTimeout,
        clearTimeout,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        alert: () => {},
        confirm: () => true,
        navigator: { clipboard: { writeText: async () => {} } },
    };
    ctx.addEventListener = () => {};
    ctx.window = ctx;
    ctx.globalThis = ctx;
    ctx.api = {
        startSpider: () => {},
        onSpiderResult: (cb) => { ctx._onResult = cb; },
        onSpiderResultsBatch: (cb) => { ctx._onBatch = cb; },
        onSpiderEnd: (cb) => { ctx._onEnd = cb; },
        onSpiderProgress: () => {},
        onSpiderReferrersUpdate: (cb) => { ctx._onReferrers = cb; },
        onSessionDumpRequestSave: () => {},
        onSessionDumpLoaded: () => {},
        pauseSpider: async () => ({ ok: true }),
        resumeSpider: async () => ({ ok: true }),
        stopSpider: () => {},
        openExternal: async () => ({ ok: true }),
        getSettings: async () => ({
            settings: { useSitemap: false, maxPages: 0, concurrency: 3 },
            filePath: '',
        }),
    };
    ctx.window.api = ctx.api;

    const sharedRoot = path.join(__dirname, '../../src/shared');
    const root = path.join(__dirname, '../../src/renderer');
    const sandbox = vm.createContext(ctx);
    const files = [
        path.join(sharedRoot, 'hook-registry.js'),
        path.join(root, 'ui-logic.js'),
        path.join(root, 'ui-hooks.js'),
        path.join(root, 'ui-defaults.js'),
        path.join(root, 'plugins/og-meta.js'),
        path.join(root, 'scan-store.js'),
        path.join(root, 'table-column-layout.js'),
        path.join(root, 'table-filters.js'),
        path.join(root, 'table-view.js'),
        path.join(root, 'detail-panel.js'),
        path.join(root, 'workspace-controller.js'),
        path.join(root, 'scan-handlers.js'),
        path.join(root, 'export-csv.js'),
        path.join(root, 'session-dump.js'),
        path.join(root, 'settings-store.js'),
        path.join(root, 'renderer.js'),
    ];
    for (const file of files) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
    }
    return ctx;
}

function flushTimers(ctx) {
    while (ctx._timerQueue?.length) {
        const fn = ctx._timerQueue.shift();
        fn();
    }
}

function armTimerFlush(ctx) {
    const origSetTimeout = ctx.setTimeout;
    ctx._timerQueue = [];
    ctx.setTimeout = (fn, _ms) => {
        ctx._timerQueue.push(fn);
        return ctx._timerQueue.length;
    };
    ctx.flushTimers = () => flushTimers(ctx);
    return origSetTimeout;
}

describe('scan end preserves page fields', () => {
    it('keeps title, meta description and h1 in table after spider-end', () => {
        const ctx = loadRendererScripts();
        const origSetTimeout = armTimerFlush(ctx);
        ctx.document.getElementById('urlInput').value = 'http://localhost/';
        ctx.setUIState('running');

        ctx._onResult({
            url: 'http://localhost/',
            status: 200,
            title: 'Home',
            contentType: 'text/html',
            fetched: true,
            referrers: [],
            headings: [{ level: 1, text: 'Home H1' }],
            metaDescription: 'Home Desc',
            ogTitle: 'OG Home',
        });
        ctx.flushTimers();

        const tableDuring = ctx.document.getElementById('resultsTable').innerHTML;
        assert.match(tableDuring, /Home Desc/, 'title/meta visible during scan');

        ctx._onEnd('Сканування завершено!');

        const tableAfter = ctx.document.getElementById('resultsTable').innerHTML;
        assert.match(tableAfter, /Home Desc/, 'meta description after end');
        assert.match(tableAfter, /Home H1/, 'h1 after end');
        assert.match(tableAfter, /OG Home/, 'og title after end');
        ctx.setTimeout = origSetTimeout;
    });

    it('keeps fields after referrers update at end', () => {
        const ctx = loadRendererScripts();
        ctx.document.getElementById('urlInput').value = 'http://localhost/';

        ctx._onResult({
            url: 'http://localhost/page',
            status: 200,
            title: 'Page',
            contentType: 'text/html',
            fetched: true,
            referrers: [{ href: 'http://localhost/', text: 'Home', tag: 'a[href]' }],
            headings: [{ level: 1, text: 'Page H1' }],
            metaDescription: 'Page Desc',
        });

        ctx._onEnd('done');
        ctx._onReferrers({
            referrers: {
                'http://localhost/page': [{ href: 'http://localhost/', text: 'Home', tag: 'a[href]' }],
                'http://localhost/other': [{ href: 'http://localhost/page', text: 'Link', tag: 'a[href]' }],
            },
            robotsByUrl: {},
        });

        const tableAfter = ctx.document.getElementById('resultsTable').innerHTML;
        assert.match(tableAfter, /Page Desc/);
        assert.match(tableAfter, /Page H1/);
    });

    it('keeps html extract fields when a later update omits them', () => {
        const ctx = loadRendererScripts();
        armTimerFlush(ctx);
        ctx.document.getElementById('urlInput').value = 'http://localhost/';
        ctx.setUIState('running');

        ctx._onResult({
            url: 'http://localhost/page',
            status: 200,
            title: 'Page',
            contentType: 'text/html',
            fetched: true,
            referrers: [],
            headings: [{ level: 1, text: 'Page H1' }],
            metaDescription: 'Page Desc',
            ogTitle: 'OG Page',
        });

        ctx._onResult({
            url: 'http://localhost/page',
            status: 200,
            title: '',
            contentType: 'text/html',
            fetched: true,
            referrers: [{ href: 'http://localhost/', text: 'Home', tag: 'a[href]' }],
        });
        ctx.flushTimers();
        ctx._onEnd('done');

        const tableAfter = ctx.document.getElementById('resultsTable').innerHTML;
        assert.match(tableAfter, /Page Desc/, 'meta survives sparse re-upsert');
        assert.match(tableAfter, /Page H1/, 'h1 survives sparse re-upsert');
        assert.match(tableAfter, /OG Page/, 'og survives sparse re-upsert');
    });
});
