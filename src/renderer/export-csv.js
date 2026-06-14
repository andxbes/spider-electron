/**
 * CSV export via ui:exportColumns hook.
 */
(function initExportCsv(root) {
const { resolveExportColumns } = root;

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
    link.download = `spider_filtered_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

const exported = { exportFilteredResultsToCsv };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
