/**
 * Default UI hook registrations: table columns, detail rows, CSV export.
 */
(function initUiDefaults(root) {
const { UI_HOOKS, uiHookRegistry } = root;

function buildDefaultTableColumns(ctx) {
    const {
        urlCellHtml,
        getRowMetrics,
        getDuplicateCounts,
        getPageTitle,
        shouldHavePageTitle,
        getTextDuplicateCount,
        getH1Count,
        getH1Texts,
    } = ctx.helpers;

    return [
        {
            id: 'index',
            sortable: false,
            cellNowrap: true,
            thClass: 'p-2 font-semibold',
            thLabel: '#',
            renderCell: (_data, _ctx, displayIndex) => `<td class="p-2 text-zinc-400">${displayIndex}</td>`,
        },
        {
            id: 'url',
            sortKey: 'url',
            minWidth: 240,
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'URL',
            renderCell: (data) => `<td class="p-2">${urlCellHtml(data.url)}</td>`,
        },
        {
            id: 'status',
            sortKey: 'status',
            cellNowrap: true,
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'Status',
            renderCell: (data) => `<td class="p-2"><span class="font-mono font-semibold ${statusRowClass(data.status)}">${escapeHtml(data.status)}</span></td>`,
        },
        {
            id: 'contentType',
            sortKey: 'contentType',
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'Content-Type',
            renderCell: (data) => `<td class="p-2 font-mono text-zinc-600 break-all" title="${escapeHtml(data.contentType || '')}">${data.contentType ? escapeHtml(data.contentType) : '<span class="text-zinc-400 italic">—</span>'}</td>`,
        },
        {
            id: 'responseTimeMs',
            sortKey: 'responseTimeMs',
            cellNowrap: true,
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'Time (ms)',
            renderCell: (data) => `<td class="p-2 text-right">${formatResponseTimeMs(data.responseTimeMs)}</td>`,
        },
        {
            id: 'metaRobots',
            sortKey: 'metaRobots',
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'Meta robots',
            renderCell: (data) => `<td class="p-2">${metaRobotsCellHtml(data)}</td>`,
        },
        {
            id: 'robotsTxt',
            sortKey: 'robotsTxt',
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'Robots.txt',
            renderCell: (data) => `<td class="p-2">${robotsTxtCellHtml(data)}</td>`,
        },
        {
            id: 'h1',
            sortKey: 'h1',
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'H1',
            renderCell: (data) => {
                const dupCounts = getDuplicateCounts();
                return `<td class="p-2">${h1CellHtml(data, dupCounts)}</td>`;
            },
        },
        {
            id: 'title',
            sortKey: 'title',
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'Title',
            renderCell: (data) => {
                const dupCounts = getDuplicateCounts();
                const pageTitle = getPageTitle(data);
                return `<td class="p-2" title="${escapeHtml(pageTitle)}">${pageTitle ? escapeHtml(pageTitle) : '<span class="text-zinc-400 italic">—</span>'}${titleCellBadge(data, dupCounts)}</td>`;
            },
        },
        {
            id: 'metaDescription',
            sortKey: 'metaDescription',
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200',
            thLabel: 'Meta Description',
            renderCell: (data) => {
                const dupCounts = getDuplicateCounts();
                const descDup = getTextDuplicateCount(data.metaDescription, dupCounts.description);
                return `<td class="p-2" title="${escapeHtml(data.metaDescription)}">${data.metaDescription ? escapeHtml(data.metaDescription) : '<span class="text-zinc-400 italic">—</span>'}${shouldHavePageTitle(data) ? duplicateCountBadge(descDup) : ''}</td>`;
            },
        },
        {
            id: 'linkCount',
            sortKey: 'linkCount',
            cellNowrap: true,
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200 text-center',
            thLabel: 'Links',
            renderCell: (data) => {
                const { linkCount, internalCount, externalCount } = getRowMetrics(data);
                const linksTitle = `Всього: ${linkCount}, внутрішніх: ${internalCount}, зовнішніх: ${externalCount}`;
                return `<td class="p-2 text-center" title="${escapeHtml(linksTitle)}">${linkCount}</td>`;
            },
        },
        {
            id: 'inCount',
            sortKey: 'inCount',
            cellNowrap: true,
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200 text-center',
            thLabel: 'Внутр.',
            renderCell: (data) => {
                const { inCount } = getRowMetrics(data);
                return `<td class="p-2 text-center">${inCount}</td>`;
            },
        },
        {
            id: 'internalCount',
            sortKey: 'internalCount',
            cellNowrap: true,
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200 text-center',
            thLabel: 'Зовн.→',
            renderCell: (data) => {
                const { internalCount } = getRowMetrics(data);
                return `<td class="p-2 text-center text-emerald-700">${internalCount}</td>`;
            },
        },
        {
            id: 'externalCount',
            sortKey: 'externalCount',
            cellNowrap: true,
            thClass: 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200 text-center',
            thLabel: 'Зовн.',
            renderCell: (data) => {
                const { externalCount } = getRowMetrics(data);
                return `<td class="p-2 text-center${externalCount > 0 ? ' text-amber-700 font-semibold' : ''}">${externalCount}</td>`;
            },
        },
    ];
}

function buildDefaultDetailRows(data, ctx) {
    const {
        urlCellHtml,
        getReferrersForUrl,
        getRowMetrics,
        getDuplicateCounts,
        getPageTitle,
        shouldHavePageTitle,
        getTextDuplicateCount,
        getH1Count,
        getH1Texts,
        isDiscoveredOnly,
        isExternalLink,
        formatLinkKindLabel,
        getResourceKind,
        getLinkTag,
    } = ctx.helpers;

    if (isDiscoveredOnly(data)) {
        return [
            ['Address', urlCellHtml(data.url)],
            ['Тип', escapeHtml(formatLinkKindLabel(getResourceKind(data)))],
            ['Тег', escapeHtml(getLinkTag(data))],
            ['Текст', data.text ? escapeHtml(data.text) : '<span class="text-zinc-400 italic">—</span>'],
            ['Джерело', isExternalLink(data) ? 'Зовнішнє' : 'Внутрішнє'],
            ['Завантажено', '<span class="text-zinc-500 italic">ні (лише знайдено)</span>'],
            ['Вхідних посилань', String(getReferrersForUrl(data.url).length)],
        ];
    }

    const h1List = (data.headings || []).filter((h) => h.level === 1);
    const h2List = (data.headings || []).filter((h) => h.level === 2);
    const { inCount, linkCount, externalCount } = getRowMetrics(data);
    const internalCount = linkCount - externalCount;

    const rows = [
        ['Address', urlCellHtml(data.url)],
        ['Status Code', escapeHtml(data.status)],
        ['Content-Type', escapeHtml(data.contentType) || '<span class="text-zinc-400 italic">—</span>'],
        ['Response Time (ms)', data.responseTimeMs ?? '—'],
        ['Resource Type', escapeHtml(formatLinkKindLabel(getResourceKind(data)))],
        ['Title', getPageTitle(data) ? escapeHtml(getPageTitle(data)) : '<span class="text-zinc-400 italic">—</span>'],
        ['Title Length', getPageTitle(data) ? String(getPageTitle(data).length) : '0'],
        ['Meta Description', escapeHtml(data.metaDescription) || '<span class="text-zinc-400 italic">—</span>'],
        ['Meta Description Length', data.metaDescription ? String(data.metaDescription.length) : '0'],
        ['Canonical', data.metaCanonical ? urlCellHtml(data.metaCanonical) : '<span class="text-zinc-400 italic">—</span>'],
        ['Meta robots', formatMetaRobotsDetail(data)],
        ['Robots.txt', formatRobotsTxtDetail(data)],
        ['H1 Count', String(getH1Count(data))],
        [
            'H1',
            h1List.length
                ? h1List.map((h) => escapeHtml(h.text)).join('<br>')
                : '<span class="text-zinc-400 italic">—</span>',
        ],
        [
            'H2',
            h2List.length
                ? h2List.map((h) => escapeHtml(h.text)).join('<br>')
                : '<span class="text-zinc-400 italic">—</span>',
        ],
        ['Вихідних посилань', String(linkCount)],
        ['Зовнішніх посилань', externalCount > 0 ? String(externalCount) : '<span class="text-zinc-400 italic">0</span>'],
        ['Внутрішніх посилань', String(internalCount)],
        ['Вхідних посилань', String(inCount)],
    ];

    const dupCounts = getDuplicateCounts();
    const titleDup = getTextDuplicateCount(getPageTitle(data), dupCounts.title);
    const descDup = getTextDuplicateCount(data.metaDescription, dupCounts.description);
    if (titleDup > 1) {
        rows.push(['Дублікатів Title', `<span class="text-amber-600 font-semibold">${titleDup} сторінок</span>`]);
    }
    if (shouldHavePageTitle(data) && descDup > 1) {
        rows.push(['Дублікатів Meta Description', `<span class="text-amber-600 font-semibold">${descDup} сторінок</span>`]);
    }
    const h1DupEntries = getH1Texts(data)
        .map((text) => ({
            text,
            count: getTextDuplicateCount(text, dupCounts.h1),
        }))
        .filter((entry) => entry.count > 1);
    if (h1DupEntries.length) {
        rows.push([
            'Дублікатів H1',
            h1DupEntries
                .map((entry) => `${escapeHtml(entry.text)} — ${entry.count} стор.`)
                .join('<br>'),
        ]);
    }

    if (data.redirectUrl) {
        rows.push(['Redirect URL', urlCellHtml(data.redirectUrl)]);
    }

    return rows;
}

function buildDefaultExportColumns(ctx) {
    const {
        getRowMetrics,
        getReferrersForUrl,
        getOutgoingLinksFrom,
        getPageTitle,
        getResourceType,
        getH1Count,
        formatCsvUrlListPreview,
    } = ctx.helpers;

    return [
        { id: 'url', header: 'URL', value: (data) => `"${(data.url || '').replace(/"/g, '""')}"` },
        { id: 'status', header: 'Status', value: (data) => `"${(data.status || '')}"` },
        { id: 'metaRobots', header: 'Meta Robots', value: (data) => `"${(data.metaRobotsLabel || data.metaRobots || '').replace(/"/g, '""')}"` },
        { id: 'robotsRule', header: 'Robots.txt Rule', value: (data) => `"${(data.robotsRule || '').replace(/"/g, '""')}"` },
        { id: 'robotsAllowed', header: 'Robots.txt Allowed', value: (data) => `"${data.robotsAllowed === false ? 'Заборонено' : (data.robotsAllowed ? 'Дозволено' : '')}"` },
        { id: 'h1Count', header: 'H1 Count', value: (data) => `"${getH1Count(data)}"` },
        { id: 'contentType', header: 'Content-Type', value: (data) => `"${(data.contentType || '').replace(/"/g, '""')}"` },
        { id: 'responseTimeMs', header: 'Response Time (ms)', value: (data) => `"${data.responseTimeMs ?? ''}"` },
        { id: 'resourceType', header: 'Resource Type', value: (data) => `"${getResourceType(data)}"` },
        { id: 'title', header: 'Title', value: (data) => `"${getPageTitle(data).replace(/"/g, '""')}"` },
        { id: 'metaDescription', header: 'Meta Description', value: (data) => `"${(data.metaDescription || '').replace(/"/g, '""')}"` },
        { id: 'canonical', header: 'Canonical', value: (data) => `"${(data.metaCanonical || '').replace(/"/g, '""')}"` },
        {
            id: 'linkCount',
            header: 'Link Count',
            value: (data) => `"${getRowMetrics(data).linkCount}"`,
        },
        {
            id: 'internalLinks',
            header: 'Internal Links',
            value: (data) => `"${getRowMetrics(data).internalCount}"`,
        },
        {
            id: 'externalLinks',
            header: 'External Links',
            value: (data) => `"${getRowMetrics(data).externalCount}"`,
        },
        { id: 'redirectUrl', header: 'Redirect URL', value: (data) => `"${(data.redirectUrl || '').replace(/"/g, '""')}"` },
        {
            id: 'referrers',
            header: 'Referrers',
            value: (data) => `"${formatCsvUrlListPreview(getReferrersForUrl(data.url)).replace(/"/g, '""')}"`,
        },
        {
            id: 'outlinks',
            header: 'Outlinks',
            value: (data) => `"${formatCsvUrlListPreview(getOutgoingLinksFrom(data.url).map((link) => link.url)).replace(/"/g, '""')}"`,
        },
        {
            id: 'headings',
            header: 'Headings',
            value: (data) => `"${data.headings ? data.headings.map((h) => `H${h.level}: ${h.text}`).join('; ') : ''}"`.replace(/"/g, '""'),
        },
    ];
}

function registerDefaultUiPresentations(getHelpers) {
    uiHookRegistry.register(UI_HOOKS.TABLE_COLUMNS, (ctx, columns) => {
        if (columns) {
            return columns;
        }
        return buildDefaultTableColumns({ ...ctx, helpers: getHelpers() });
    }, { priority: 0, id: 'default-table-columns' });

    uiHookRegistry.register(UI_HOOKS.DETAIL_ROWS, (ctx, rows) => {
        if (rows) {
            return rows;
        }
        if (!ctx.data) {
            return [];
        }
        return buildDefaultDetailRows(ctx.data, { ...ctx, helpers: getHelpers() });
    }, { priority: 0, id: 'default-detail-rows' });

    uiHookRegistry.register(UI_HOOKS.EXPORT_COLUMNS, (ctx, columns) => {
        if (columns) {
            return columns;
        }
        return buildDefaultExportColumns({ ...ctx, helpers: getHelpers() });
    }, { priority: 0, id: 'default-export-columns' });
}

const exported = { registerDefaultUiPresentations, buildDefaultTableColumns, buildDefaultDetailRows, buildDefaultExportColumns };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
