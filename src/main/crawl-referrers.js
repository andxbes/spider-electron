const { normalizePageUrl } = require('../shared/url-utils');

const referrersMap = new Map();

function isImgReferrerTag(tag) {
    const normalized = String(tag || '');
    return normalized === 'img[src]' || normalized === 'img[srcset]' || normalized === 'img';
}

function normalizeImgAltState(meta = {}) {
    const tag = meta.tag || '';
    const hasImgAlt = meta.imgAlt !== undefined;
    const imgAltMissing = meta.imgAltMissing === true;
    if (!isImgReferrerTag(tag) && !imgAltMissing && !hasImgAlt) {
        return null;
    }
    return {
        tag,
        imgAltMissing,
        ...(hasImgAlt ? { imgAlt: meta.imgAlt } : {}),
    };
}

function getImgAltStatesFromMeta(meta = {}) {
    if (Array.isArray(meta.imgAltStates) && meta.imgAltStates.length) {
        return meta.imgAltStates
            .map((state) => normalizeImgAltState(state))
            .filter(Boolean);
    }
    const single = normalizeImgAltState(meta);
    return single ? [single] : [];
}

function imgAltStateKey(state) {
    return `${state.tag}|${state.imgAltMissing ? 'missing' : 'alt'}|${state.imgAlt ?? ''}`;
}

function mergeImgAltStateLists(left = [], right = []) {
    const seen = new Set();
    const merged = [];
    for (const state of [...left, ...right]) {
        const key = imgAltStateKey(state);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        merged.push(state);
    }
    return merged;
}

function summarizeImgAltFields(states) {
    if (!states.length) {
        return {};
    }
    const summary = {
        imgAltStates: states,
        imgAltMissing: states.some((state) => state.imgAltMissing),
    };
    const withAlt = states.find((state) => !state.imgAltMissing && state.imgAlt !== undefined);
    if (withAlt) {
        summary.imgAlt = withAlt.imgAlt;
    }
    return summary;
}

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
        ...summarizeImgAltFields(getImgAltStatesFromMeta(meta)),
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
    const imgAltStates = mergeImgAltStateLists(
        getImgAltStatesFromMeta(existing),
        getImgAltStatesFromMeta(incoming),
    );
    targetMap.set(referrerUrl, {
        text,
        rel: existing.rel || incoming.rel,
        tag: existing.tag || incoming.tag,
        kind: existing.kind || incoming.kind,
        relFollowAllowed: mergeRelFlag(existing.relFollowAllowed, incoming.relFollowAllowed),
        relIndexAllowed: mergeRelFlag(existing.relIndexAllowed, incoming.relIndexAllowed),
        relLabel: existing.relLabel || incoming.relLabel,
        ...summarizeImgAltFields(imgAltStates),
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
        ...summarizeImgAltFields(getImgAltStatesFromMeta(meta)),
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
        imgAltMissing: link.imgAltMissing === true,
        ...(link.imgAlt !== undefined ? { imgAlt: link.imgAlt } : {}),
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
