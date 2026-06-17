const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_REQUEST_DELAY_MS,
    MAX_REQUEST_DELAY_MS,
    normalizeRequestDelayMs,
    computeJitteredDelayMs,
    setScanRequestDelayMs,
    getScanRequestDelayMs,
    clearScanRequestDelayMs,
} = require('../../src/main/request-delay');

describe('request-delay', () => {
    it('normalizeRequestDelayMs defaults missing values to 500', () => {
        assert.equal(normalizeRequestDelayMs(undefined), DEFAULT_REQUEST_DELAY_MS);
        assert.equal(normalizeRequestDelayMs(''), DEFAULT_REQUEST_DELAY_MS);
    });

    it('normalizeRequestDelayMs allows zero and clamps max', () => {
        assert.equal(normalizeRequestDelayMs(0), 0);
        assert.equal(normalizeRequestDelayMs(999_999), MAX_REQUEST_DELAY_MS);
        assert.equal(normalizeRequestDelayMs(-5), DEFAULT_REQUEST_DELAY_MS);
    });

    it('computeJitteredDelayMs returns zero for disabled delay', () => {
        assert.equal(computeJitteredDelayMs(0), 0);
    });

    it('computeJitteredDelayMs stays within ±20%', () => {
        for (let i = 0; i < 20; i += 1) {
            const delay = computeJitteredDelayMs(500);
            assert.ok(delay >= 400 && delay <= 600, `unexpected jitter: ${delay}`);
        }
    });

    it('scan delay context can be set and cleared', () => {
        setScanRequestDelayMs(250);
        assert.equal(getScanRequestDelayMs(), 250);
        clearScanRequestDelayMs();
        assert.equal(getScanRequestDelayMs(), 0);
    });
});
