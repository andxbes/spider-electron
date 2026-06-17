const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_USER_AGENT,
    DEFAULT_USER_AGENT_PRESET_ID,
    CUSTOM_USER_AGENT_PRESET_ID,
    normalizeUserAgentSettings,
    resolveUserAgent,
    getUserAgentPreset,
} = require('../../src/shared/user-agents');

describe('user-agents', () => {
    it('resolveUserAgent returns preset value', () => {
        const ua = resolveUserAgent({ userAgentPreset: 'googlebot' });
        assert.match(ua, /Googlebot/);
    });

    it('resolveUserAgent uses custom string for custom preset', () => {
        const ua = resolveUserAgent({
            userAgentPreset: CUSTOM_USER_AGENT_PRESET_ID,
            userAgentCustom: 'MyBot/2.0',
        });
        assert.equal(ua, 'MyBot/2.0');
    });

    it('resolveUserAgent falls back to default for unknown preset', () => {
        const ua = resolveUserAgent({ userAgentPreset: 'unknown-bot' });
        assert.equal(ua, getUserAgentPreset(DEFAULT_USER_AGENT_PRESET_ID).value);
    });

    it('resolveUserAgent falls back when custom preset is empty', () => {
        const ua = resolveUserAgent({
            userAgentPreset: CUSTOM_USER_AGENT_PRESET_ID,
            userAgentCustom: '   ',
        });
        assert.equal(ua, DEFAULT_USER_AGENT);
    });

    it('normalizeUserAgentSettings clamps invalid preset id', () => {
        const normalized = normalizeUserAgentSettings({
            userAgentPreset: 'bad',
            userAgentCustom: ' custom ',
        });
        assert.equal(normalized.userAgentPreset, DEFAULT_USER_AGENT_PRESET_ID);
        assert.equal(normalized.userAgentCustom, 'custom');
    });
});
