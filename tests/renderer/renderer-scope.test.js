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
            appendChild() {},
            querySelectorAll: () => [],
            addEventListener() {},
            dataset: {},
            setAttribute() {},
            focus() {},
            offsetHeight: 0,
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
        createElement: (tag) => ({ ...makeEl(tag), click() {} }),
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
        onSpiderResultsBatch: () => {},
        onSpiderEnd: (cb) => { ctx._onEnd = cb; },
        onSpiderProgress: () => {},
        onSpiderReferrersUpdate: () => {},
        onSessionDumpRequestSave: () => {},
        onSessionDumpLoaded: () => {},
        pauseSpider: async () => ({ ok: true }),
        resumeSpider: async () => ({ ok: true }),
        stopSpider: () => {},
        openExternal: async (url) => { ctx._opened = url; return { ok: true }; },
        getSettings: async () => ({ settings: { useSitemap: false, maxPages: 0, concurrency: 3 }, filePath: '' }),
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
        path.join(root, 'plugins', 'og-meta.js'),
        path.join(root, 'scan-store.js'),
        path.join(root, 'table-column-layout.js'),
        path.join(root, 'table-view.js'),
        path.join(root, 'detail-panel.js'),
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

describe('renderer scope smoke', () => {
    it('copy/open url actions and duplicate counts work after refactor', async () => {
        const ctx = loadRendererScripts();

        ctx._onResult({
            url: 'http://localhost/',
            status: 200,
            title: 'Home',
            contentType: 'text/html',
            fetched: true,
            referrers: [],
            headings: [{ level: 1, text: 'Home' }],
            metaRobotsStatus: 'allowed',
            robotsAllowed: true,
            metaDescription: 'Home',
        });
        ctx._onEnd('Сканування завершено!');

        assert.doesNotThrow(() => ctx.getDuplicateCounts());

        await ctx.copyUrlToClipboard('http://localhost/page');
        assert.equal(ctx.document.getElementById('status-text').textContent, 'Посилання скопійовано');

        await ctx.openUrlInBrowser('http://localhost/page');
        assert.equal(ctx._opened, 'http://localhost/page');

        ctx.setActiveTab('inlinks');
        assert.match(ctx.document.getElementById('detailContent').innerHTML, /Всього вхідних|Немає вхідних/);

        ctx.setActiveTab('outlinks');
        assert.match(ctx.document.getElementById('detailContent').innerHTML, /Всього:|Немає вихідних/);
    });
});
