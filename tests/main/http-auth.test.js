const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    AUTH_TYPES,
    normalizeAuthType,
    normalizeAuthSettings,
    buildAuthorizationHeader,
    getAuthHeadersForUrl,
} = require('../../src/main/http-auth');

describe('http-auth', () => {
    it('normalizeAuthType falls back to none for unknown values', () => {
        assert.equal(normalizeAuthType('basic'), AUTH_TYPES.BASIC);
        assert.equal(normalizeAuthType('BEARER'), AUTH_TYPES.BEARER);
        assert.equal(normalizeAuthType('digest'), AUTH_TYPES.NONE);
    });

    it('buildAuthorizationHeader encodes Basic credentials', () => {
        const header = buildAuthorizationHeader({
            authType: 'basic',
            authUsername: 'user',
            authPassword: 'secret',
        });
        assert.equal(header, `Basic ${Buffer.from('user:secret').toString('base64')}`);
    });

    it('buildAuthorizationHeader returns Bearer token', () => {
        const header = buildAuthorizationHeader({
            authType: 'bearer',
            authToken: 'abc123',
        });
        assert.equal(header, 'Bearer abc123');
    });

    it('buildAuthorizationHeader returns null when credentials missing', () => {
        assert.equal(buildAuthorizationHeader({ authType: 'basic' }), null);
        assert.equal(buildAuthorizationHeader({ authType: 'bearer' }), null);
        assert.equal(buildAuthorizationHeader({ authType: 'none' }), null);
    });

    it('getAuthHeadersForUrl applies auth only to scan hostname', () => {
        const auth = {
            authType: 'basic',
            authUsername: 'user',
            authPassword: 'pass',
        };
        const internal = getAuthHeadersForUrl('https://example.com/page', 'example.com', auth);
        const external = getAuthHeadersForUrl('https://other.com/page', 'example.com', auth);

        assert.ok(internal.Authorization?.startsWith('Basic '));
        assert.deepEqual(external, {});
    });

    it('getAuthHeadersForUrl returns empty object for authType none', () => {
        assert.deepEqual(
            getAuthHeadersForUrl('https://example.com/', 'example.com', { authType: 'none' }),
            {}
        );
    });
});
