/**
 * Renderer plugin: redirect chains — table column, details, CSV.
 */
(function initRedirectChainUiPlugin(root) {
const { UI_HOOKS, uiHookRegistry } = root;

const PLUGIN_ID = 'redirect-chain';

function redirectCellClass(data) {
    if (data?.redirectInfinite) {
        return 'text-red-700 font-bold';
    }
    if (hasMultipleRedirects(data)) {
        return 'text-amber-700 font-semibold';
    }
    if (hasRedirectChainData(data)) {
        return 'text-blue-700 font-medium';
    }
    return 'text-zinc-600';
}

function renderRedirectCell(data) {
    if (!hasRedirectChainData(data)) {
        return '<td class="p-2 text-center"><span class="text-zinc-400 italic">—</span></td>';
    }
    const label = formatRedirectCellLabel(data);
    const tooltip = escapeHtml(formatRedirectChainTooltip(data));
    const cls = redirectCellClass(data);
    const arrow = data.redirectFinalUrl && !data.redirectInfinite
        ? ` <span class="text-zinc-400 font-normal">→</span>`
        : '';
    return `<td class="p-2 text-center" title="${tooltip}"><span class="${cls}">${escapeHtml(label)}</span>${arrow}</td>`;
}

function registerRedirectChainUiPlugin() {
    uiHookRegistry.register(UI_HOOKS.TABLE_COLUMNS, (ctx, cols) => [
        ...cols.slice(0, 4),
        {
            id: 'redirectChain',
            sortKey: 'redirectHopCount',
            cellNowrap: true,
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200 text-center',
            thLabel: 'Редирект',
            renderCell: (data) => renderRedirectCell(data),
        },
        ...cols.slice(4),
    ], { priority: 45, id: `${PLUGIN_ID}-table-columns` });

    uiHookRegistry.register(UI_HOOKS.DETAIL_ROWS, (ctx, rows) => {
        const { data } = ctx;
        const { urlCellHtml } = ctx.helpers;
        if (!hasRedirectChainData(data)) {
            return rows;
        }
        const extra = [];
        if (data.redirectHopCount > 0) {
            extra.push(['Редиректів', String(data.redirectHopCount)]);
        }
        if (data.redirectFinalUrl) {
            extra.push([
                'Кінцевий URL',
                urlCellHtml(data.redirectFinalUrl),
            ]);
        }
        if (Array.isArray(data.redirectChain) && data.redirectChain.length > 1) {
            extra.push([
                'Ланцюг',
                data.redirectChain
                    .map((entry, index) => `${index + 1}. ${escapeHtml(entry)}`)
                    .join('<br>'),
            ]);
        }
        if (data.redirectInfinite) {
            extra.push([
                'Цикл редиректів',
                '<span class="text-red-700 font-semibold">Так (обмеження 20 переходів)</span>',
            ]);
            if (data.redirectLoopStartUrl) {
                extra.push([
                    'Перше повторення',
                    urlCellHtml(data.redirectLoopStartUrl),
                ]);
            }
        }
        return [...rows, ...extra];
    }, { priority: 45, id: `${PLUGIN_ID}-detail-rows` });

    uiHookRegistry.register(UI_HOOKS.EXPORT_COLUMNS, (ctx, cols) => [
        ...cols,
        {
            id: 'redirectHopCount',
            header: 'Redirect Hops',
            value: (data) => `"${data.redirectHopCount ?? 0}"`,
        },
        {
            id: 'redirectFinalUrl',
            header: 'Redirect Final URL',
            value: (data) => `"${(data.redirectFinalUrl || '').replace(/"/g, '""')}"`,
        },
        {
            id: 'redirectInfinite',
            header: 'Redirect Infinite',
            value: (data) => `"${data.redirectInfinite ? 'yes' : 'no'}"`,
        },
        {
            id: 'redirectLoopStartUrl',
            header: 'Redirect Loop Start URL',
            value: (data) => `"${(data.redirectLoopStartUrl || '').replace(/"/g, '""')}"`,
        },
    ], { priority: 45, id: `${PLUGIN_ID}-export-columns` });
}

registerRedirectChainUiPlugin();

const exported = { PLUGIN_ID, registerRedirectChainUiPlugin };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
