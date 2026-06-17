/**
 * Redirect chain tracking: hop limit, loop detection, result fields, table labels.
 */
(function initRedirectChain(root) {
const { isRedirectStatus, resolveRedirectTarget } = (typeof require !== 'undefined')
    ? require('./url-utils')
    : root;

const MAX_REDIRECT_HOPS = 20;

function findFirstRepeatedUrl(chain) {
    const seen = new Set();
    for (const entry of chain) {
        if (seen.has(entry)) {
            return entry;
        }
        seen.add(entry);
    }
    return '';
}

function createRedirectChainTracker(startUrl, maxHops = MAX_REDIRECT_HOPS) {
    const chain = [startUrl];
    const hops = [];
    let infinite = false;
    let loopStartUrl = '';

    return {
        get hopCount() {
            return hops.length;
        },
        get infinite() {
            return infinite;
        },
        get chainUrls() {
            return chain.slice();
        },
        get finalUrl() {
            return chain[chain.length - 1] || '';
        },
        get firstHopTarget() {
            return hops[0]?.to || '';
        },
        get firstHopStatus() {
            return hops[0]?.status ?? null;
        },
        get firstHopResponseTimeMs() {
            return hops[0]?.responseTimeMs ?? null;
        },
        get loopStartUrl() {
            return loopStartUrl;
        },
        canFollow() {
            return hops.length < maxHops && !infinite;
        },
        recordHop({ from, to, status, responseTimeMs }) {
            hops.push({ from, to, status, responseTimeMs });
            chain.push(to);
            loopStartUrl = findFirstRepeatedUrl(chain);
        },
        markInfinite(repeatUrl = '') {
            infinite = true;
            if (repeatUrl) {
                loopStartUrl = repeatUrl;
            } else if (!loopStartUrl) {
                loopStartUrl = findFirstRepeatedUrl(chain);
            }
        },
        toFields() {
            const hopCount = hops.length;
            const finalUrl = hopCount ? chain[chain.length - 1] : '';
            return {
                redirectHopCount: hopCount,
                redirectFinalUrl: finalUrl,
                redirectInfinite: infinite,
                redirectChain: chain.slice(),
                redirectLoopStartUrl: loopStartUrl,
                redirectUrl: hops[0]?.to || '',
            };
        },
    };
}

function hasRedirectChainData(data) {
    if (!data) {
        return false;
    }
    return Boolean(data.redirectInfinite)
        || (Number(data.redirectHopCount) > 0)
        || Boolean(data.redirectFinalUrl);
}

function hasMultipleRedirects(data) {
    return Number(data?.redirectHopCount) >= 2;
}

function redirectHopCountSortValue(data) {
    if (data?.redirectInfinite) {
        return 10000 + Number(data.redirectHopCount || 0);
    }
    return Number(data?.redirectHopCount || 0);
}

function formatRedirectChainTooltip(data) {
    const chain = Array.isArray(data?.redirectChain) ? data.redirectChain : [];
    if (!chain.length) {
        return '';
    }
    const lines = chain.map((entry, index) => `${index + 1}. ${entry}`);
    if (data.redirectInfinite) {
        lines.push('⚠ Цикл / занадто довгий ланцюг');
        if (data.redirectLoopStartUrl) {
            lines.push(`Перше повторення: ${data.redirectLoopStartUrl}`);
        }
    }
    if (data.redirectFinalUrl && data.redirectFinalUrl !== chain[0]) {
        lines.push(`Кінцева: ${data.redirectFinalUrl}`);
    }
    return lines.join('\n');
}

function formatRedirectCellLabel(data) {
    if (data?.redirectInfinite) {
        const hops = Number(data.redirectHopCount || 0);
        return hops > 0 ? `∞ ${hops}+` : '∞';
    }
    const hops = Number(data?.redirectHopCount || 0);
    if (hops <= 0) {
        return '';
    }
    return String(hops);
}

const exported = {
    MAX_REDIRECT_HOPS,
    createRedirectChainTracker,
    findFirstRepeatedUrl,
    hasRedirectChainData,
    hasMultipleRedirects,
    redirectHopCountSortValue,
    formatRedirectChainTooltip,
    formatRedirectCellLabel,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(typeof globalThis !== 'undefined' ? globalThis : root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : {});
