const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    createHtmlParsePool,
    parseHtmlDocument,
    terminateHtmlParsePool,
} = require('../../src/main/html-parse-pool');

describe('html-parse-pool', () => {
    afterEach(async () => {
        await terminateHtmlParsePool();
    });

    it('runs cheerio parsing in worker threads', async () => {
        const pool = createHtmlParsePool(2);
        const html = '<html><head><title>Worker</title></head><body><a href="a">A</a></body></html>';

        const [first, second] = await Promise.all([
            pool.parse(html, 'https://example.com/', 'example.com'),
            pool.parse(html, 'https://example.com/page/', 'example.com'),
        ]);

        await pool.terminate();

        assert.equal(first.pageFields.title, 'Worker');
        assert.equal(second.pageFields.title, 'Worker');
        assert.equal(first.pageLinks[0].url, 'https://example.com/a');
        assert.equal(second.pageLinks[0].url, 'https://example.com/page/a');
    });

    it('parseHtmlDocument in-process matches worker output', async () => {
        const html = '<html><head><title>Sync</title></head><body><a href="/z">Z</a></body></html>';
        const pool = createHtmlParsePool(1);
        const workerResult = await pool.parse(html, 'https://example.com/', 'example.com');
        const syncResult = parseHtmlDocument(html, 'https://example.com/', 'example.com');
        await pool.terminate();

        assert.deepEqual(workerResult, syncResult);
    });
});
