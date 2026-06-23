const { parentPort } = require('worker_threads');
const { parseHtmlDocument } = require('./html-parser');

parentPort.on('message', (message) => {
    const { id, html, currentUrl, allowedHostname } = message;
    try {
        const result = parseHtmlDocument(html, currentUrl, allowedHostname);
        parentPort.postMessage({ id, ok: true, result });
    } catch (error) {
        parentPort.postMessage({
            id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
