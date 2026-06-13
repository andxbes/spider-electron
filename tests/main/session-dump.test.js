const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateDump, DUMP_VERSION } = require('../../src/main/session-dump');

describe('session-dump main', () => {
    it('validateDump accepts version 1 with results array', () => {
        assert.deepEqual(validateDump({ version: DUMP_VERSION, results: [] }), { ok: true });
    });

    it('validateDump rejects wrong version', () => {
        const result = validateDump({ version: 99, results: [] });
        assert.equal(result.ok, false);
    });

    it('validateDump rejects missing results', () => {
        const result = validateDump({ version: DUMP_VERSION });
        assert.equal(result.ok, false);
    });
});
