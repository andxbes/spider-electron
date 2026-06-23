const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { parseHtmlDocument, extractDefaultPageFields } = require('../../src/main/html-parser');
const { collectPageLinks } = require('../../src/main/link-collector');

describe('html-parser', () => {
    it('parseHtmlDocument extracts page fields and links', () => {
        const html = `<!DOCTYPE html>
<html>
<head>
  <title>Page</title>
  <meta name="description" content="Desc">
  <meta property="og:title" content="OG">
  <link rel="canonical" href="https://example.com/canonical">
</head>
<body>
  <h1>Heading</h1>
  <a href="/next">Next</a>
  <script src="/app.js"></script>
</body>
</html>`;

        const parsed = parseHtmlDocument(html, 'https://example.com/start', 'example.com');

        assert.equal(parsed.pageFields.title, 'Page');
        assert.equal(parsed.pageFields.metaDescription, 'Desc');
        assert.equal(parsed.pageFields.ogTitle, 'OG');
        assert.equal(parsed.pageFields.metaCanonical, 'https://example.com/canonical');
        assert.deepEqual(parsed.pageFields.headings, [{ level: 1, text: 'Heading' }]);
        assert.ok(parsed.pageLinks.some((link) => link.url === 'https://example.com/next'));
        assert.ok(parsed.pageLinks.some((link) => link.kind === 'javascript'));
    });

    it('extractDefaultPageFields matches direct cheerio extraction', () => {
        const html = '<html><head><title>T</title></head><body><a href="/x">X</a></body></html>';
        const $ = cheerio.load(html);
        const fields = extractDefaultPageFields($);
        const links = collectPageLinks($, 'https://example.com/', 'example.com');
        const parsed = parseHtmlDocument(html, 'https://example.com/', 'example.com');

        assert.deepEqual(fields, {
            title: parsed.pageFields.title,
            metaDescription: parsed.pageFields.metaDescription,
            metaCanonical: parsed.pageFields.metaCanonical,
            headings: parsed.pageFields.headings,
            metaRobotsRaw: parsed.pageFields.metaRobotsRaw,
        });
        assert.deepEqual(links, parsed.pageLinks);
    });
});
