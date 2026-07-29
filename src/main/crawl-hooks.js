const { createHookRegistry } = require('../shared/hook-registry');

/** @typedef {import('electron').BrowserWindow} BrowserWindow */

const CRAWL_HOOKS = {
    /** (ctx, fields) => fields — збирає дані з HTML (title, meta, headings, …) */
    EXTRACT_PAGE: 'crawl:extractPage',
    /** (ctx, result) => result — фінальна трансформація перед відправкою */
    BUILD_RESULT: 'crawl:buildResult',
    /** (ctx, result) => result | false — false = не відправляти */
    BEFORE_EMIT_RESULT: 'crawl:beforeEmitResult',
    /** (ctx, link) => link | false — фільтр знайдених посилань */
    FILTER_DISCOVERED_LINK: 'crawl:filterDiscoveredLink',
    /** (ctx, stubs[]) => stubs[] — batch знайдених посилань */
    TRANSFORM_BATCH: 'crawl:transformBatch',
};

const crawlHookRegistry = createHookRegistry({ name: 'crawl' });

/** Coalesce many spider-result IPC messages into fewer batches (large scans). */
const DEFAULT_RESULT_COALESCE_MS = 150;
const DEFAULT_RESULT_COALESCE_MAX = 500;

let resultCoalesceMs = DEFAULT_RESULT_COALESCE_MS;
let resultCoalesceMax = DEFAULT_RESULT_COALESCE_MAX;
let coalescingForcedOffForTests = false;
let pendingResults = [];
let pendingWindow = null;
let flushTimer = null;

function clearResultFlushTimer() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
}

function flushPendingSpiderResults() {
    clearResultFlushTimer();
    if (pendingResults.length === 0 || !pendingWindow) {
        pendingResults = [];
        return;
    }
    const batch = pendingResults;
    const browserWindow = pendingWindow;
    pendingResults = [];
    if (browserWindow.isDestroyed?.()) {
        pendingWindow = null;
        return;
    }
    if (batch.length === 1) {
        browserWindow.webContents.send('spider-result', batch[0]);
    } else {
        browserWindow.webContents.send('spider-results-batch', batch);
    }
}

function scheduleResultFlush() {
    if (resultCoalesceMs <= 0 || pendingResults.length >= resultCoalesceMax) {
        flushPendingSpiderResults();
        return;
    }
    if (flushTimer) {
        return;
    }
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushPendingSpiderResults();
    }, resultCoalesceMs);
}

function enqueueSpiderPayload(browserWindow, payload) {
    if (!browserWindow || payload == null) {
        return;
    }
    if (pendingWindow && pendingWindow !== browserWindow) {
        flushPendingSpiderResults();
    }
    pendingWindow = browserWindow;
    pendingResults.push(payload);
    scheduleResultFlush();
}

/**
 * Immediate emit for tests; production uses coalesce window.
 * @param {{ coalesceMs?: number, coalesceMax?: number } | false} [opts]
 */
function setSpiderResultCoalescingForTests(opts = false) {
    flushPendingSpiderResults();
    if (opts === false || opts == null) {
        coalescingForcedOffForTests = true;
        resultCoalesceMs = 0;
        resultCoalesceMax = 1;
        return;
    }
    coalescingForcedOffForTests = false;
    resultCoalesceMs = opts.coalesceMs ?? DEFAULT_RESULT_COALESCE_MS;
    resultCoalesceMax = opts.coalesceMax ?? DEFAULT_RESULT_COALESCE_MAX;
}

function resetSpiderResultCoalescing() {
    flushPendingSpiderResults();
    if (coalescingForcedOffForTests) {
        resultCoalesceMs = 0;
        resultCoalesceMax = 1;
        pendingWindow = null;
        return;
    }
    resultCoalesceMs = DEFAULT_RESULT_COALESCE_MS;
    resultCoalesceMax = DEFAULT_RESULT_COALESCE_MAX;
    pendingWindow = null;
}

/**
 * @param {BrowserWindow} browserWindow
 * @param {object} result
 * @returns {object|null}
 */
function emitSpiderResult(browserWindow, result) {
    const ctx = { browserWindow, channel: 'spider-result' };
    let payload = crawlHookRegistry.runWaterfallSync(CRAWL_HOOKS.BUILD_RESULT, ctx, result);
    payload = crawlHookRegistry.runWaterfallSync(CRAWL_HOOKS.BEFORE_EMIT_RESULT, ctx, payload);
    if (payload === false || payload == null) {
        return null;
    }
    enqueueSpiderPayload(browserWindow, payload);
    return payload;
}

/**
 * @param {BrowserWindow} browserWindow
 * @param {object[]} stubs
 */
function emitSpiderResultsBatch(browserWindow, stubs) {
    const ctx = { browserWindow, channel: 'spider-results-batch' };
    const payload = crawlHookRegistry.runWaterfallSync(CRAWL_HOOKS.TRANSFORM_BATCH, ctx, stubs);
    if (!Array.isArray(payload) || payload.length === 0) {
        return;
    }
    if (resultCoalesceMs <= 0) {
        browserWindow.webContents.send('spider-results-batch', payload);
        return;
    }
    for (const item of payload) {
        enqueueSpiderPayload(browserWindow, item);
    }
}

/**
 * @param {object} ctx — { $, response, url, hostname }
 * @param {object} [seed]
 */
function extractPageViaHooks(ctx, seed = {}) {
    return crawlHookRegistry.runWaterfallSync(CRAWL_HOOKS.EXTRACT_PAGE, ctx, seed);
}

/**
 * @param {object} ctx
 * @param {object[]} links
 */
function filterDiscoveredLinksViaHooks(ctx, links) {
    return crawlHookRegistry.runFilterSync(CRAWL_HOOKS.FILTER_DISCOVERED_LINK, ctx, links);
}

module.exports = {
    CRAWL_HOOKS,
    crawlHookRegistry,
    emitSpiderResult,
    emitSpiderResultsBatch,
    flushPendingSpiderResults,
    setSpiderResultCoalescingForTests,
    resetSpiderResultCoalescing,
    extractPageViaHooks,
    filterDiscoveredLinksViaHooks,
};
