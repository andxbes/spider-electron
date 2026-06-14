/**
 * Renderer plugin: Open Graph — колонка таблиці, деталі, CSV.
 */
(function initOgMetaUiPlugin(root) {
const { UI_HOOKS, uiHookRegistry } = root;

const PLUGIN_ID = 'og-meta';

function isHtmlPageForOg(data) {
    return data
        && data.fetched !== false
        && (isHtmlContentType(data.contentType || '') || shouldHavePageTitle(data));
}

function registerOgMetaUiPlugin() {
    uiHookRegistry.register(UI_HOOKS.TABLE_COLUMNS, (ctx, cols) => [
        ...cols,
        {
            id: 'ogTitle',
            sortKey: 'ogTitle',
            minWidth: 130,
            thClass: 'sortable-th p-2 font-semibold min-w-[120px] cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'OG Title',
            renderCell: (data) => {
                if (!data.ogTitle) {
                    return '<td class="p-2"><span class="text-zinc-400 italic">—</span></td>';
                }
                return `<td class="p-2" title="${escapeHtml(data.ogTitle)}">${escapeHtml(data.ogTitle)}</td>`;
            },
        },
        {
            id: 'ogImage',
            sortKey: 'ogImage',
            minWidth: 150,
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'OG Image',
            renderCell: (data, detailCtx) => {
                const { urlCellHtml } = detailCtx.helpers;
                if (!data.ogImage) {
                    return '<td class="p-2"><span class="text-zinc-400 italic">—</span></td>';
                }
                return `<td class="p-2" title="${escapeHtml(data.ogImage)}">${urlCellHtml(data.ogImage)}</td>`;
            },
        },
    ], { priority: 50, id: `${PLUGIN_ID}-table-columns` });

    uiHookRegistry.register(UI_HOOKS.DETAIL_ROWS, (ctx, rows) => {
        if (!isHtmlPageForOg(ctx.data)) {
            return rows;
        }
        const { data } = ctx;
        const { urlCellHtml } = ctx.helpers;
        return [
            ...rows,
            ['OG Title', data.ogTitle ? escapeHtml(data.ogTitle) : '<span class="text-zinc-400 italic">—</span>'],
            ['OG Description', data.ogDescription ? escapeHtml(data.ogDescription) : '<span class="text-zinc-400 italic">—</span>'],
            ['OG Image', data.ogImage ? urlCellHtml(data.ogImage) : '<span class="text-zinc-400 italic">—</span>'],
        ];
    }, { priority: 50, id: `${PLUGIN_ID}-detail-rows` });

    uiHookRegistry.register(UI_HOOKS.EXPORT_COLUMNS, (ctx, cols) => [
        ...cols,
        {
            id: 'ogTitle',
            header: 'OG Title',
            value: (data) => `"${(data.ogTitle || '').replace(/"/g, '""')}"`,
        },
        {
            id: 'ogDescription',
            header: 'OG Description',
            value: (data) => `"${(data.ogDescription || '').replace(/"/g, '""')}"`,
        },
        {
            id: 'ogImage',
            header: 'OG Image',
            value: (data) => `"${(data.ogImage || '').replace(/"/g, '""')}"`,
        },
    ], { priority: 50, id: `${PLUGIN_ID}-export-columns` });
}

registerOgMetaUiPlugin();

const exported = { PLUGIN_ID, registerOgMetaUiPlugin };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
