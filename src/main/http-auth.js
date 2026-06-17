const { isSameHost } = require('../shared/url-utils');

const AUTH_TYPES = {
    NONE: 'none',
    BASIC: 'basic',
    BEARER: 'bearer',
};

const AUTH_TYPE_VALUES = new Set(Object.values(AUTH_TYPES));

function normalizeAuthType(value) {
    const type = String(value || AUTH_TYPES.NONE).trim().toLowerCase();
    return AUTH_TYPE_VALUES.has(type) ? type : AUTH_TYPES.NONE;
}

function normalizeAuthSettings(raw) {
    const authType = normalizeAuthType(raw?.authType);
    return {
        authType,
        authUsername: String(raw?.authUsername || '').trim(),
        authPassword: String(raw?.authPassword || ''),
        authToken: String(raw?.authToken || '').trim(),
    };
}

function buildAuthorizationHeader(auth) {
    const normalized = normalizeAuthSettings(auth);
    if (normalized.authType === AUTH_TYPES.BASIC) {
        if (!normalized.authUsername && !normalized.authPassword) {
            return null;
        }
        const credentials = Buffer
            .from(`${normalized.authUsername}:${normalized.authPassword}`)
            .toString('base64');
        return `Basic ${credentials}`;
    }
    if (normalized.authType === AUTH_TYPES.BEARER) {
        if (!normalized.authToken) {
            return null;
        }
        return `Bearer ${normalized.authToken}`;
    }
    return null;
}

function getAuthHeadersForUrl(url, scanHostname, auth) {
    if (!scanHostname || !auth) {
        return {};
    }
    const normalized = normalizeAuthSettings(auth);
    if (normalized.authType === AUTH_TYPES.NONE) {
        return {};
    }
    try {
        if (!isSameHost(url, scanHostname)) {
            return {};
        }
    } catch {
        return {};
    }
    const authorization = buildAuthorizationHeader(normalized);
    if (!authorization) {
        return {};
    }
    return { Authorization: authorization };
}

module.exports = {
    AUTH_TYPES,
    normalizeAuthType,
    normalizeAuthSettings,
    buildAuthorizationHeader,
    getAuthHeadersForUrl,
};
