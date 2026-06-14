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
    browserWindow.webContents.send('spider-result', payload);
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
    browserWindow.webContents.send('spider-results-batch', payload);
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
    extractPageViaHooks,
    filterDiscoveredLinksViaHooks,
};
