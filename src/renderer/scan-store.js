/**
 * In-memory store for scan results. Hooks allow transforming data on ingest.
 */
(function initScanStore(root) {
const { transformStoredResult } = root;

const PAGE_EXTRACT_FIELDS = [
    'title',
    'metaDescription',
    'metaCanonical',
    'headings',
    'ogTitle',
    'ogDescription',
    'ogImage',
    'metaRobots',
    'metaRobotsStatus',
    'metaRobotsLabel',
];

function isEmptyExtractField(field, value) {
    if (field === 'headings') {
        return !Array.isArray(value) || value.length === 0;
    }
    return value === '' || value === undefined || value === null;
}

function mergeFetchedPageFields(existing, incoming) {
    if (!existing || existing.fetched === false || incoming.fetched === false) {
        return incoming;
    }
    const merged = { ...incoming };
    for (const field of PAGE_EXTRACT_FIELDS) {
        if (isEmptyExtractField(field, merged[field]) && !isEmptyExtractField(field, existing[field])) {
            merged[field] = existing[field];
        }
    }
    if ((merged.responseTimeMs === null || merged.responseTimeMs === undefined)
        && existing.responseTimeMs !== null
        && existing.responseTimeMs !== undefined) {
        merged.responseTimeMs = existing.responseTimeMs;
    }
    return merged;
}

function createScanStore(options = {}) {
    const scanResults = new Map();
    const insertionOrder = [];
    let latestReferrersByUrl = new Map();
    let latestRobotsByUrl = new Map();
    let duplicateCountsCache = null;
    /** @type {Map<string, object[]> | null} */
    let outgoingLinksByPageCache = null;
    let scanHostname = '';

    const getScanHostname = options.getScanHostname || (() => scanHostname);

    function invalidateOutgoingLinksCache() {
        outgoingLinksByPageCache = null;
    }

    function invalidateDuplicateCounts() {
        duplicateCountsCache = null;
    }

    function setScanHostname(hostname) {
        scanHostname = hostname;
    }

    function normalizeIncoming(data) {
        return normalizeLinkEntryImpl(data, getScanHostname());
    }

    function upsertRaw(incoming, { deferUi = false } = {}) {
        const transformed = transformStoredResult(
            { scanResults, getScanHostname },
            incoming
        );
        const incomingUrl = typeof transformed === 'object'
            ? (transformed.url || transformed.href)
            : transformed;
        const existingBeforeMerge = incomingUrl ? scanResults.get(incomingUrl) : undefined;
        const merged = existingBeforeMerge
            ? mergeFetchedPageFields(existingBeforeMerge, transformed)
            : transformed;
        const data = normalizeIncoming(merged);
        const existing = scanResults.get(data.url);
        if (existing && existing.fetched !== false && data.fetched === false) {
            const enrichesResource = isJavascriptResource(data) || isCssResource(data) || isMediaResource(data);
            const enrichesCrawledAsset = existing
                && !isHtmlContentType(existing.contentType || '')
                && (data.kind || data.tag);
            if (existing && (enrichesResource || enrichesCrawledAsset)) {
                scanResults.set(data.url, normalizeIncoming({
                    ...existing,
                    kind: data.kind || existing.kind,
                    tag: data.tag || existing.tag,
                    text: data.text || existing.text,
                }));
                return { isNew: false, changed: true };
            }
            return { isNew: false, changed: false };
        }
        const isNew = !existing;
        if (isNew) {
            insertionOrder.push(data.url);
        }
        scanResults.set(data.url, data);
        return { isNew, changed: true, deferUi };
    }

    function clearData() {
        invalidateDuplicateCounts();
        latestReferrersByUrl = new Map();
        latestRobotsByUrl = new Map();
        scanResults.clear();
        insertionOrder.length = 0;
        outgoingLinksByPageCache = null;
    }

    function getReferrersForUrl(url) {
        let raw = [];
        if (latestReferrersByUrl.has(url)) {
            raw = latestReferrersByUrl.get(url);
        } else {
            const data = scanResults.get(url);
            if (data?.referrers?.length) {
                raw = data.referrers;
            }
        }
        return raw.map(normalizeReferrerEntry).filter((entry) => entry.href);
    }

    function rebuildLatestReferrersFromResults() {
        latestReferrersByUrl = new Map();
        latestRobotsByUrl = new Map();
        for (const [url, data] of scanResults.entries()) {
            if (data.referrers?.length) {
                latestReferrersByUrl.set(url, data.referrers);
            }
        }
    }

    function mergeRobotsFieldsIfMissing(data, robotsFields) {
        if (!robotsFields || (robotsFields.robotsAllowed == null && !robotsFields.robotsRule)) {
            return data;
        }
        if (data.robotsAllowed != null || data.robotsRule) {
            return data;
        }
        return {
            ...data,
            robotsAllowed: robotsFields.robotsAllowed,
            robotsRule: robotsFields.robotsRule,
        };
    }

    function materializeDiscoveredFromReferrers() {
        let changed = false;
        for (const [url, refs] of latestReferrersByUrl.entries()) {
            if (scanResults.has(url)) {
                continue;
            }
            const refText = refs[0]?.text || '';
            const robotsFields = latestRobotsByUrl.get(url) || {};
            const upsertResult = upsertRaw({
                url,
                status: '',
                title: '',
                text: refText,
                external: isExternalUrlImpl(url, getScanHostname()),
                fetched: false,
                kind: '',
                tag: '',
                referrers: refs,
                ...robotsFields,
            }, { deferUi: true });
            if (upsertResult.changed) {
                changed = true;
            }
        }
        if (changed) {
            reinferAllLinkKinds();
            invalidateOutgoingLinksCache();
        }
        return changed;
    }

    function applyReferrersUpdate(payload) {
        const referrersPayload = payload?.referrers ?? payload;
        const robotsPayload = payload?.robotsByUrl ?? {};
        latestReferrersByUrl = new Map();
        latestRobotsByUrl = new Map(Object.entries(robotsPayload));
        for (const [url, refs] of Object.entries(referrersPayload || {})) {
            const normalized = Array.isArray(refs)
                ? refs.map(normalizeReferrerEntry).filter((entry) => entry.href)
                : [];
            latestReferrersByUrl.set(url, normalized);
        }

        for (const [url, data] of scanResults.entries()) {
            if (latestReferrersByUrl.has(url)) {
                data.referrers = latestReferrersByUrl.get(url);
            }
            const merged = mergeRobotsFieldsIfMissing(data, latestRobotsByUrl.get(url));
            if (merged !== data) {
                scanResults.set(url, normalizeIncoming(merged));
            }
        }
        materializeDiscoveredFromReferrers();
        invalidateOutgoingLinksCache();
    }

    function buildOutgoingLink(ref, targetEntry) {
        const edgeHasRelMeta = Boolean(ref.rel)
            || ref.relFollowAllowed !== null
            || ref.relIndexAllowed !== null
            || Boolean(ref.relLabel);
        return normalizeIncoming({
            ...targetEntry,
            url: targetEntry.url,
            text: ref.text || targetEntry.text || '',
            tag: ref.tag || targetEntry.tag || '',
            kind: ref.kind || targetEntry.kind || '',
            rel: edgeHasRelMeta ? (ref.rel || '') : (targetEntry.rel || ''),
            relFollowAllowed: edgeHasRelMeta
                ? (ref.relFollowAllowed ?? null)
                : (targetEntry.relFollowAllowed ?? null),
            relIndexAllowed: edgeHasRelMeta
                ? (ref.relIndexAllowed ?? null)
                : (targetEntry.relIndexAllowed ?? null),
            relLabel: edgeHasRelMeta ? (ref.relLabel || '') : (targetEntry.relLabel || ''),
        });
    }

    function rebuildOutgoingLinksCache() {
        const cache = new Map();
        for (const entry of scanResults.values()) {
            for (const ref of getReferrersForUrl(entry.url)) {
                if (!ref.href) {
                    continue;
                }
                if (!cache.has(ref.href)) {
                    cache.set(ref.href, []);
                }
                cache.get(ref.href).push(buildOutgoingLink(ref, entry));
            }
        }
        outgoingLinksByPageCache = cache;
    }

    function getOutgoingLinksFrom(pageUrl) {
        if (!outgoingLinksByPageCache) {
            rebuildOutgoingLinksCache();
        }
        return outgoingLinksByPageCache.get(pageUrl) || [];
    }

    function reinferAllLinkKinds() {
        for (const [url, entry] of scanResults.entries()) {
            scanResults.set(url, normalizeIncoming(entry));
        }
    }

    function getDuplicateCounts() {
        const entries = Array.from(scanResults.values());
        if (!duplicateCountsCache) {
            duplicateCountsCache = {
                h1: buildH1DuplicateCounts(entries),
                title: buildFieldDuplicateCounts((data) => getPageTitle(data), entries),
                description: buildFieldDuplicateCounts((data) => (
                    shouldHavePageTitle(data) ? String(data.metaDescription || '').trim() : ''
                ), entries),
            };
        }
        return duplicateCountsCache;
    }

    return {
        scanResults,
        insertionOrder,
        getScanHostname,
        setScanHostname,
        upsertRaw,
        clearData,
        getReferrersForUrl,
        getOutgoingLinksFrom,
        rebuildLatestReferrersFromResults,
        applyReferrersUpdate,
        materializeDiscoveredFromReferrers,
        reinferAllLinkKinds,
        invalidateOutgoingLinksCache,
        invalidateDuplicateCounts,
        getDuplicateCounts,
        get latestReferrersByUrl() { return latestReferrersByUrl; },
        get latestRobotsByUrl() { return latestRobotsByUrl; },
    };
}

const exported = { createScanStore };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
