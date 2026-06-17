const { CRAWL_HOOKS, crawlHookRegistry } = require('../crawl-hooks');

const PLUGIN_ID = 'redirect-chain';

function withRedirectDefaults(fields) {
    return {
        redirectHopCount: 0,
        redirectFinalUrl: '',
        redirectInfinite: false,
        redirectChain: [],
        redirectLoopStartUrl: '',
        redirectHopOnly: false,
        ...fields,
    };
}

function registerRedirectChainPlugin() {
    crawlHookRegistry.register(CRAWL_HOOKS.BUILD_RESULT, (_ctx, result) => (
        withRedirectDefaults(result)
    ), { priority: 5, id: `${PLUGIN_ID}-build-result-defaults` });
}

registerRedirectChainPlugin();

module.exports = {
    PLUGIN_ID,
    withRedirectDefaults,
    registerRedirectChainPlugin,
};
