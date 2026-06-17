const DEFAULT_REQUEST_DELAY_MS = 500;
const MAX_REQUEST_DELAY_MS = 60_000;
const REQUEST_DELAY_JITTER_RATIO = 0.2;

let scanRequestDelayMs = 0;

function normalizeRequestDelayMs(value) {
    if (value === '' || value === null || value === undefined) {
        return DEFAULT_REQUEST_DELAY_MS;
    }
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
        return DEFAULT_REQUEST_DELAY_MS;
    }
    return Math.min(MAX_REQUEST_DELAY_MS, parsed);
}

function computeJitteredDelayMs(baseMs) {
    if (!baseMs || baseMs <= 0) {
        return 0;
    }
    const spread = REQUEST_DELAY_JITTER_RATIO * 2;
    const factor = 1 - REQUEST_DELAY_JITTER_RATIO + Math.random() * spread;
    return Math.round(baseMs * factor);
}

function setScanRequestDelayMs(value) {
    scanRequestDelayMs = normalizeRequestDelayMs(value);
}

function getScanRequestDelayMs() {
    return scanRequestDelayMs;
}

function clearScanRequestDelayMs() {
    scanRequestDelayMs = 0;
}

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitBeforeRequest() {
    const delayMs = computeJitteredDelayMs(scanRequestDelayMs);
    if (delayMs > 0) {
        await wait(delayMs);
    }
}

module.exports = {
    DEFAULT_REQUEST_DELAY_MS,
    MAX_REQUEST_DELAY_MS,
    REQUEST_DELAY_JITTER_RATIO,
    normalizeRequestDelayMs,
    computeJitteredDelayMs,
    setScanRequestDelayMs,
    getScanRequestDelayMs,
    clearScanRequestDelayMs,
    waitBeforeRequest,
};
