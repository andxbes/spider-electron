/**
 * CSV export: main table + detail panel in/out links.
 */
(function initExportCsv(root) {
const {
    resolveExportColumns,
    compareLinkRowsImpl,
    getLinkTag,
    getLinkRelInfo,
    isExternalOutlink,
} = root;

function formatCsvStamp(date) {
    const value = date instanceof Date ? date : new Date(date || Date.now());
    return value.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsvFileName(startUrl) {
    let host = '';
    try {
        host = new URL(startUrl).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    } catch {
        host = 'scan';
    }
    return `spider_${host}_${formatCsvStamp(new Date())}.csv`;
}

function urlToFileSlug(pageUrl) {
    try {
        const parsed = new URL(pageUrl);
        const host = parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const pathPart = parsed.pathname
            .replace(/^\/+|\/+$/g, '')
            .replace(/[^a-zA-Z0-9.-]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        return pathPart ? `${host}_${pathPart}` : host;
    } catch {
        return 'page';
    }
}

function buildPageLinksCsvFileName(pageUrl, direction, scanStartedAt) {
    const slug = urlToFileSlug(pageUrl);
    const stamp = formatCsvStamp(scanStartedAt || new Date());
    return `${slug}-${direction}-${stamp}.csv`;
}

function formatFollowCsv(allowed) {
    if (allowed === null || allowed === undefined) {
        return '—';
    }
    return allowed ? 'Дозволено' : 'Обмежено';
}

function getLinkUrlForCsv(link, type) {
    if (type === 'in') {
        return link.href || link.url || '';
    }
    return link.url || link.href || '';
}

function linkToCsvRow(link, type) {
    const relInfo = getLinkRelInfo(link);
    const relValue = relInfo.applicable
        ? (relInfo.rel || 'follow')
        : '—';
    const followValue = relInfo.applicable
        ? formatFollowCsv(relInfo.relFollowAllowed)
        : '—';
    const cells = [
        getLinkUrlForCsv(link, type),
        getLinkTag(link),
        relValue,
        followValue,
        link.text || '',
    ];
    if (type === 'out') {
        cells.push(isExternalOutlink(link) ? 'Так' : 'Ні');
    }
    return cells.map(csvEscape).join(',');
}

const PAGE_LINKS_CSV_HEADERS = {
    in: ['Source URL', 'Tag', 'rel', 'Follow', 'Anchor Text'],
    out: ['URL', 'Tag', 'rel', 'Follow', 'Anchor Text', 'External'],
};

function downloadCsvFile(fileName, csvRows) {
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
}

function exportFilteredResultsToCsv(entries, ctx) {
    const columns = resolveExportColumns(ctx);
    const csvRows = [columns.map((col) => col.header).join(',')];

    for (const data of entries) {
        csvRows.push(columns.map((col) => col.value(data, ctx)).join(','));
    }

    downloadCsvFile(buildCsvFileName(ctx.startUrl || ''), csvRows);
}

function exportPageLinksToCsv({ pageUrl, type, links, sortState, scanStartedAt }) {
    if (!pageUrl || (type !== 'in' && type !== 'out')) {
        return { ok: false, reason: 'invalid' };
    }
    if (!links?.length) {
        return { ok: false, reason: 'empty' };
    }

    const sorted = [...links].sort((a, b) => compareLinkRowsImpl(a, b, sortState));
    const csvRows = [
        PAGE_LINKS_CSV_HEADERS[type].join(','),
        ...sorted.map((link) => linkToCsvRow(link, type)),
    ];
    downloadCsvFile(
        buildPageLinksCsvFileName(pageUrl, type, scanStartedAt),
        csvRows
    );
    return { ok: true, count: sorted.length };
}

const exported = {
    formatCsvStamp,
    csvEscape,
    buildCsvFileName,
    urlToFileSlug,
    buildPageLinksCsvFileName,
    formatFollowCsv,
    linkToCsvRow,
    exportFilteredResultsToCsv,
    exportPageLinksToCsv,
    PAGE_LINKS_CSV_HEADERS,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
