const {
    CRAWL_HOOKS,
    crawlHookRegistry,
} = require('./crawl-hooks');
const {
    extractPageTitle,
    extractMetaDescription,
    extractHeadings,
    extractMetaRobotsRaw,
} = require('./page-extractors');

function registerDefaultCrawlHooks() {
    crawlHookRegistry.register(CRAWL_HOOKS.EXTRACT_PAGE, (ctx, fields) => ({
        ...fields,
        title: extractPageTitle(ctx.$),
        metaDescription: extractMetaDescription(ctx.$),
        metaCanonical: ctx.$('link[rel="canonical"]').attr('href') || '',
        headings: extractHeadings(ctx.$),
        metaRobotsRaw: extractMetaRobotsRaw(ctx.$, ctx.response),
    }), { priority: 0, id: 'default-extract-page' });

    crawlHookRegistry.register(CRAWL_HOOKS.BUILD_RESULT, (_ctx, result) => result, {
        priority: 0,
        id: 'default-build-result',
    });

    crawlHookRegistry.register(CRAWL_HOOKS.BEFORE_EMIT_RESULT, (_ctx, result) => result, {
        priority: 0,
        id: 'default-before-emit',
    });

    crawlHookRegistry.register(CRAWL_HOOKS.TRANSFORM_BATCH, (_ctx, stubs) => stubs, {
        priority: 0,
        id: 'default-transform-batch',
    });
}

registerDefaultCrawlHooks();

module.exports = {
    registerDefaultCrawlHooks,
};
