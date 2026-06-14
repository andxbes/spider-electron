const { normalizePageUrl } = require('../shared/url-utils');

const referrersMap = new Map();

function normalizeReferrerMeta(linkMeta = {}) {
    const meta = typeof linkMeta === 'string' ? { text: linkMeta } : (linkMeta || {});
    return {
        text: String(meta.text || '').trim().slice(0, 200),
        rel: meta.rel || '',
        tag: meta.tag || '',
        kind: meta.kind || '',
        relFollowAllowed: meta.relFollowAllowed ?? null,
        relIndexAllowed: meta.relIndexAllowed ?? null,
        relLabel: meta.relLabel || '',
    };
}

function mergeReferrerMeta(targetMap, referrerUrl, linkMeta = {}) {
    const incoming = normalizeReferrerMeta(linkMeta);
    if (!targetMap.has(referrerUrl)) {
        targetMap.set(referrerUrl, incoming);
        return;
    }
    const existing = normalizeReferrerMeta(targetMap.get(referrerUrl));
    let text = existing.text || '';
    if (incoming.text && incoming.text !== text) {
        if (!text) {
            text = incoming.text;
        } else if (!text.includes(incoming.text)) {
            text = `${text}; ${incoming.text}`.slice(0, 200);
        }
    }
    const mergeRelFlag = (left, right) => {
        if (left === false || right === false) {
            return false;
        }
        if (left === true || right === true) {
            return true;
        }
        return null;
    };
    targetMap.set(referrerUrl, {
        text,
        rel: existing.rel || incoming.rel,
        tag: existing.tag || incoming.tag,
        kind: existing.kind || incoming.kind,
        relFollowAllowed: mergeRelFlag(existing.relFollowAllowed, incoming.relFollowAllowed),
        relIndexAllowed: mergeRelFlag(existing.relIndexAllowed, incoming.relIndexAllowed),
        relLabel: existing.relLabel || incoming.relLabel,
    });
}

function addReferrer(targetUrl, referrerUrl, linkMeta = {}) {
    if (!referrersMap.has(targetUrl)) {
        referrersMap.set(targetUrl, new Map());
    }
    try {
        mergeReferrerMeta(referrersMap.get(targetUrl), normalizePageUrl(referrerUrl), linkMeta);
    } catch {
        mergeReferrerMeta(referrersMap.get(targetUrl), referrerUrl, linkMeta);
    }
}

function referrerEntry(href, linkMeta = {}) {
    const meta = normalizeReferrerMeta(linkMeta);
    return {
        href,
        text: meta.text,
        rel: meta.rel,
        tag: meta.tag,
        kind: meta.kind,
        relFollowAllowed: meta.relFollowAllowed,
        relIndexAllowed: meta.relIndexAllowed,
        relLabel: meta.relLabel,
    };
}

function getReferrersListForUrl(url) {
    const refs = referrersMap.get(url);
    if (!refs) {
        return [];
    }
    return Array.from(refs.entries()).map(([href, meta]) => referrerEntry(href, meta));
}

function getReferrersSnapshot(url, fallbackReferrer = null) {
    if (referrersMap.has(url)) {
        return getReferrersListForUrl(url);
    }
    if (fallbackReferrer && fallbackReferrer !== 'N/A') {
        return [referrerEntry(fallbackReferrer)];
    }
    return [];
}

function buildAllReferrersPayload() {
    const payload = {};
    for (const [link] of referrersMap.entries()) {
        payload[link] = getReferrersListForUrl(link);
    }
    return payload;
}

function buildReferrerLinkMeta(link) {
    return {
        text: link.text || '',
        rel: link.rel || '',
        tag: link.tag || '',
        kind: link.kind || '',
        relFollowAllowed: link.relFollowAllowed,
        relIndexAllowed: link.relIndexAllowed,
        relLabel: link.relLabel || '',
    };
}

function clearReferrers() {
    referrersMap.clear();
}

function getReferrersMapKeys() {
    return referrersMap.keys();
}

module.exports = {
    normalizeReferrerMeta,
    mergeReferrerMeta,
    addReferrer,
    referrerEntry,
    getReferrersListForUrl,
    getReferrersSnapshot,
    buildAllReferrersPayload,
    buildReferrerLinkMeta,
    clearReferrers,
    getReferrersMapKeys,
};
