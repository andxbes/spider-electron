const cheerio = require('cheerio');
const { collectPageLinks } = require('./link-collector');
const {
    extractPageTitle,
    extractMetaDescription,
    extractHeadings,
    extractMetaRobotsRaw,
} = require('./page-extractors');
const { extractOgFields } = require('./plugins/og-meta');

function extractDefaultPageFields($) {
    return {
        title: extractPageTitle($),
        metaDescription: extractMetaDescription($),
        metaCanonical: $('link[rel="canonical"]').attr('href') || '',
        headings: extractHeadings($),
        metaRobotsRaw: extractMetaRobotsRaw($),
    };
}

function parseHtmlDocument(html, currentUrl, allowedHostname) {
    const $ = cheerio.load(html);
    const pageFields = {
        ...extractDefaultPageFields($),
        ...extractOgFields($),
    };
    const pageLinks = collectPageLinks($, currentUrl, allowedHostname);
    return { pageFields, pageLinks };
}

module.exports = {
    extractDefaultPageFields,
    parseHtmlDocument,
};
