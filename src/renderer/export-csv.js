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
    formatDisplayUrl,
} = root;

function formatCsvStamp(date) {
    const value = date instanceof Date ? date : new Date(date || Date.now());
    return value.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function normalizeTableFilterMeta(meta = {}) {
    return {
        contentType: sanitizeFilePart(meta.contentType || meta.content || 'all') || 'all',
        sourceFilter: sanitizeFilePart(meta.sourceFilter || meta.source || 'all') || 'all',
        status: sanitizeFilePart(meta.status || 'all') || 'all',
        indexing: sanitizeFilePart(meta.indexing || 'all') || 'all',
        issue: sanitizeFilePart(meta.issue || 'all') || 'all',
        search: sanitizeFilePart(String(meta.search || '').trim().slice(0, 20)),
    };
}

function formatTableFiltersFileSlug(meta = {}) {
    const filters = normalizeTableFilterMeta(meta);
    const parts = [filters.contentType, filters.sourceFilter];
    if (filters.status !== 'all') {
        parts.push(`status-${filters.status}`);
    }
    if (filters.indexing !== 'all') {
        parts.push(`idx-${filters.indexing}`);
    }
    if (filters.issue !== 'all') {
        parts.push(filters.issue);
    }
    if (filters.search) {
        parts.push(`q-${filters.search}`);
    }
    return parts.join('-');
}

function buildCsvFileName(startUrl, meta = {}, stampDate) {
    let host = '';
    try {
        host = new URL(startUrl).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    } catch {
        host = 'scan';
    }
    const filterSlug = formatTableFiltersFileSlug(meta);
    return `spider_${host}-${filterSlug}_${formatCsvStamp(stampDate || new Date())}.csv`;
}

function sanitizeFilePart(value) {
    return String(value || '')
        .replace(/[^a-zA-Z0-9._=-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

const PAGE_LINKS_SLUG_MAX_LENGTH = 10;

function urlToFileSlug(pageUrl, maxLength = PAGE_LINKS_SLUG_MAX_LENGTH) {
    const limit = Number.isFinite(maxLength) && maxLength > 0
        ? maxLength
        : PAGE_LINKS_SLUG_MAX_LENGTH;
    try {
        const parsed = new URL(pageUrl);
        let pathRaw = parsed.pathname;
        try {
            pathRaw = decodeURIComponent(parsed.pathname);
        } catch {
            // keep encoded pathname
        }
        const lastSegment = pathRaw.replace(/\/+$/g, '').split('/').filter(Boolean).pop() || '';
        const slug = sanitizeFilePart(lastSegment)
            || sanitizeFilePart(parsed.hostname)
            || 'page';
        return slug.slice(0, limit) || 'page';
    } catch {
        return 'page';
    }
}

function findDisplayedRowIndex(pageUrl, displayedEntries) {
    if (!pageUrl || !Array.isArray(displayedEntries)) {
        return 0;
    }
    const index = displayedEntries.findIndex((row) => (row?.url || row) === pageUrl);
    return index >= 0 ? index + 1 : 0;
}

function normalizePageLinksFileMeta(meta = {}) {
    const rowIndex = Number.parseInt(meta.rowIndex, 10);
    return {
        contentType: sanitizeFilePart(meta.contentType || 'all') || 'all',
        sourceFilter: sanitizeFilePart(meta.sourceFilter || 'all') || 'all',
        rowIndex: Number.isFinite(rowIndex) && rowIndex > 0 ? rowIndex : 0,
    };
}

function buildPageLinksCsvFileName(pageUrl, direction, scanStartedAt, meta = {}) {
    const slug = urlToFileSlug(pageUrl);
    const stamp = formatCsvStamp(scanStartedAt || new Date());
    const { contentType, sourceFilter, rowIndex } = normalizePageLinksFileMeta(meta);
    return `${slug}-${rowIndex}-${direction}-${contentType}-${sourceFilter}-${stamp}.csv`;
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

function linkToCsvRow(link, type, pageUrl) {
    const relInfo = getLinkRelInfo(link);
    const relValue = relInfo.applicable
        ? (relInfo.rel || 'follow')
        : '—';
    const followValue = relInfo.applicable
        ? formatFollowCsv(relInfo.relFollowAllowed)
        : '—';
    const displayUrl = (value) => (
        typeof formatDisplayUrl === 'function' ? formatDisplayUrl(value) : (value || '')
    );
    const sourceUrl = type === 'in' ? displayUrl(getLinkUrlForCsv(link, type)) : displayUrl(pageUrl);
    const targetUrl = type === 'in' ? displayUrl(pageUrl) : displayUrl(getLinkUrlForCsv(link, type));
    const cells = [
        sourceUrl,
        getLinkTag(link),
        relValue,
        followValue,
        link.text || '',
    ];
    if (type === 'out') {
        cells.push(isExternalOutlink(link) ? 'Так' : 'Ні');
    }
    cells.push(targetUrl);
    return cells.map(csvEscape).join(',');
}

const PAGE_LINKS_CSV_HEADERS = {
    in: ['Source URL', 'Tag', 'rel', 'Follow', 'Anchor Text', 'Target URL'],
    out: ['Source URL', 'Tag', 'rel', 'Follow', 'Anchor Text', 'External', 'Target URL'],
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

    downloadCsvFile(buildCsvFileName(ctx.startUrl || '', ctx.filters || {}), csvRows);
}

function buildPageLinksCsvRows({ pageUrl, type, links, sortState }) {
    const sorted = [...links].sort((a, b) => compareLinkRowsImpl(a, b, sortState));
    return {
        sorted,
        csvRows: [
            PAGE_LINKS_CSV_HEADERS[type].join(','),
            ...sorted.map((link) => linkToCsvRow(link, type, pageUrl)),
        ],
    };
}

function exportPageLinksToCsv({
    pageUrl,
    type,
    links,
    sortState,
    scanStartedAt,
    contentType,
    sourceFilter,
    rowIndex,
    displayedEntries,
}) {
    if (!pageUrl || (type !== 'in' && type !== 'out')) {
        return { ok: false, reason: 'invalid' };
    }
    if (!links?.length) {
        return { ok: false, reason: 'empty' };
    }

    const { sorted, csvRows } = buildPageLinksCsvRows({ pageUrl, type, links, sortState });
    const resolvedRowIndex = rowIndex ?? findDisplayedRowIndex(pageUrl, displayedEntries);
    downloadCsvFile(
        buildPageLinksCsvFileName(pageUrl, type, scanStartedAt, {
            contentType,
            sourceFilter,
            rowIndex: resolvedRowIndex,
        }),
        csvRows
    );
    return { ok: true, count: sorted.length };
}

const exported = {
    formatCsvStamp,
    csvEscape,
    buildCsvFileName,
    formatTableFiltersFileSlug,
    sanitizeFilePart,
    urlToFileSlug,
    findDisplayedRowIndex,
    buildPageLinksCsvFileName,
    formatFollowCsv,
    linkToCsvRow,
    buildPageLinksCsvRows,
    exportFilteredResultsToCsv,
    exportPageLinksToCsv,
    PAGE_LINKS_CSV_HEADERS,
    PAGE_LINKS_SLUG_MAX_LENGTH,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
