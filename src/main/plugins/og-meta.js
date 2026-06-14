const { CRAWL_HOOKS, crawlHookRegistry } = require('../crawl-hooks');

const PLUGIN_ID = 'og-meta';

function readMetaContent($, property) {
    const value = $(`meta[property="${property}"]`).attr('content')
        || $(`meta[name="${property}"]`).attr('content')
        || '';
    return String(value).trim();
}

function extractOgFields($) {
    return {
        ogTitle: readMetaContent($, 'og:title'),
        ogDescription: readMetaContent($, 'og:description'),
        ogImage: readMetaContent($, 'og:image'),
    };
}

function registerOgMetaPlugin() {
    crawlHookRegistry.register(CRAWL_HOOKS.EXTRACT_PAGE, (ctx, fields) => ({
        ...fields,
        ...extractOgFields(ctx.$),
    }), { priority: 20, id: `${PLUGIN_ID}-extract-page` });
}

registerOgMetaPlugin();

module.exports = {
    PLUGIN_ID,
    extractOgFields,
    registerOgMetaPlugin,
};
