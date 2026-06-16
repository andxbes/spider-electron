/**
 * CSV export via ui:exportColumns hook.
 */
(function initExportCsv(root) {
const { resolveExportColumns } = root;

function buildCsvFileName(startUrl) {
    let host = '';
    try {
        host = new URL(startUrl).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    } catch {
        host = 'scan';
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `spider_${host}_${stamp}.csv`;
}

function exportFilteredResultsToCsv(entries, ctx) {
    const columns = resolveExportColumns(ctx);
    const bom = '\uFEFF';
    const csvRows = [columns.map((col) => col.header).join(',')];

    for (const data of entries) {
        csvRows.push(columns.map((col) => col.value(data, ctx)).join(','));
    }

    const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = buildCsvFileName(ctx.startUrl || '');
    link.click();
}

const exported = { exportFilteredResultsToCsv };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
