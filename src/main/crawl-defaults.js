const {
    CRAWL_HOOKS,
    crawlHookRegistry,
} = require('./crawl-hooks');
const { extractDefaultPageFields } = require('./html-parser');

function registerDefaultCrawlHooks() {
    crawlHookRegistry.register(CRAWL_HOOKS.EXTRACT_PAGE, (ctx, fields) => {
        if (!ctx.$) {
            return fields;
        }
        return {
            ...fields,
            ...extractDefaultPageFields(ctx.$),
        };
    }, { priority: 0, id: 'default-extract-page' });

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
