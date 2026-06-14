/**
 * Detail panel: tabs + link tables, rows via ui:detailRows hook.
 */
(function initDetailPanel(root) {
const { resolveDetailRows } = root;

function createDetailPanel(deps) {
    const {
        detailContent,
        getSelectedUrl,
        getRowData,
        getActiveTab,
        getReferrersForUrl,
        getOutgoingLinksFrom,
        getFilteredOutgoingLinks,
        urlCellHtml,
        getLinkTableSortState,
        setLinkTableSortState,
    } = deps;

    function renderDetailTable(rows) {
        if (rows.length === 0) {
            return '<p class="p-4 text-zinc-400 italic">Немає даних</p>';
        }
        const body = rows
            .map(
                ([name, value]) => `
        <tr class="border-b border-zinc-100 hover:bg-zinc-50">
            <td class="p-2 font-medium text-zinc-500 align-top w-40 whitespace-nowrap">${escapeHtml(name)}</td>
            <td class="p-2 text-zinc-800 break-all">${value}</td>
        </tr>`
            )
            .join('');
        return `<table class="w-full border-collapse"><tbody>${body}</tbody></table>`;
    }

    function sortLinkRows(links) {
        return [...links].sort((a, b) => compareLinkRowsImpl(a, b, getLinkTableSortState()));
    }

    function renderLinkTable(links, emptyText, caption = '') {
        if (!links || links.length === 0) {
            return `<p class="p-4 text-zinc-400 italic">${escapeHtml(emptyText)}</p>`;
        }
        const captionHtml = caption
            ? `<p class="px-4 py-2 text-xs text-zinc-500 border-b border-zinc-100 bg-zinc-50">${escapeHtml(caption)}</p>`
            : '';
        const linkTableSortState = getLinkTableSortState();
        const rows = sortLinkRows(links)
            .map(
                (link) => {
                    const external = isExternalOutlink(link);
                    const typeBadge = external
                        ? '<span class="inline-block ml-1 px-1 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 whitespace-nowrap" title="Зовнішнє посилання — не обходиться">зовн.</span>'
                        : '';
                    const tag = getLinkTag(link);
                    const relInfo = getLinkRelInfo(link);
                    const relCell = relInfo.applicable
                        ? (relInfo.rel
                            ? `<span class="font-mono">${escapeHtml(relInfo.rel)}</span>`
                            : '<span class="text-zinc-500 italic">follow</span>')
                        : '<span class="text-zinc-400 italic">—</span>';
                    return `
        <tr class="border-b border-zinc-100 hover:bg-zinc-50${external ? ' bg-amber-50/40' : ''}">
            <td class="p-2">${urlCellHtml(link.url || link.href || link)}${typeBadge}</td>
            <td class="p-2 font-mono text-zinc-600 text-[11px] whitespace-nowrap">${escapeHtml(tag)}</td>
            <td class="p-2 text-zinc-600">${relCell}</td>
            <td class="p-2 whitespace-nowrap">${formatRelAllowedStatus(relInfo.relFollowAllowed)}</td>
            <td class="p-2 text-zinc-600">${link.text ? escapeHtml(link.text) : '<span class="text-zinc-400 italic">—</span>'}</td>
        </tr>`;
                }
            )
            .join('');
        const sortThClass = 'sortable-link-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200';
        const activeSortClass = (column) => (
            linkTableSortState.column === column ? ' bg-zinc-200 text-zinc-800' : ''
        );
        return `${captionHtml}<table class="w-full border-collapse">
        <thead class="bg-zinc-50 sticky top-0">
            <tr class="text-left text-zinc-500">
                <th class="${sortThClass}${activeSortClass('url')}" data-sort="url" title="Сортувати">${linkTableSortIndicator('url', 'URL', linkTableSortState)}</th>
                <th class="${sortThClass} min-w-[110px]${activeSortClass('tag')}" data-sort="tag" title="Сортувати">${linkTableSortIndicator('tag', 'Тег', linkTableSortState)}</th>
                <th class="${sortThClass} min-w-[90px]${activeSortClass('rel')}" data-sort="rel" title="Сортувати">${linkTableSortIndicator('rel', 'rel', linkTableSortState)}</th>
                <th class="${sortThClass} w-24${activeSortClass('follow')}" data-sort="follow" title="Сортувати">${linkTableSortIndicator('follow', 'Перехід', linkTableSortState)}</th>
                <th class="${sortThClass} w-1/3${activeSortClass('text')}" data-sort="text" title="Сортувати">${linkTableSortIndicator('text', 'Текст посилання', linkTableSortState)}</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
    }

    function renderDetailPanel() {
        const selectedUrl = getSelectedUrl();
        const data = selectedUrl ? getRowData(selectedUrl) : null;
        if (!selectedUrl || !data) {
            detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть URL у таблиці вище</p>';
            return;
        }

        const activeTab = getActiveTab();
        if (activeTab === 'details') {
            const rows = resolveDetailRows({
                data,
                helpers: deps.getDetailHelpers(),
            });
            detailContent.innerHTML = renderDetailTable(rows);
        } else if (activeTab === 'inlinks') {
            const inlinks = getReferrersForUrl(data.url);
            detailContent.innerHTML = renderLinkTable(
                inlinks,
                'Немає вхідних посилань (стартова або лише з sitemap)',
                inlinks.length ? `Всього вхідних: ${inlinks.length}` : ''
            );
        } else if (activeTab === 'outlinks') {
            const allOutgoing = getOutgoingLinksFrom(data.url);
            const outgoing = getFilteredOutgoingLinks(data.url);
            const caption = deps.hasActiveLinkFilters()
                ? `Показано: ${outgoing.length} з ${allOutgoing.length}`
                : (allOutgoing.length ? `Всього: ${allOutgoing.length}` : '');
            detailContent.innerHTML = renderLinkTable(
                outgoing,
                'Немає вихідних посилань за поточними фільтрами',
                caption
            );
        }
    }

    function setActiveTab(tab) {
        deps.setActiveTab(tab);
        document.querySelectorAll('.detail-tab').forEach((btn) => {
            const isActive = btn.dataset.tab === tab;
            btn.classList.toggle('border-blue-600', isActive);
            btn.classList.toggle('text-blue-700', isActive);
            btn.classList.toggle('bg-white', isActive);
            btn.classList.toggle('border-transparent', !isActive);
            btn.classList.toggle('text-zinc-600', !isActive);
        });
        renderDetailPanel();
    }

    function bindTabs() {
        document.querySelectorAll('.detail-tab').forEach((btn) => {
            btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
        });

        detailContent.addEventListener('click', (event) => {
            const th = event.target.closest('.sortable-link-th');
            if (!th) {
                return;
            }
            const col = th.dataset.sort;
            if (!col) {
                return;
            }
            const state = getLinkTableSortState();
            if (state.column === col) {
                setLinkTableSortState({
                    column: col,
                    direction: state.direction === 'asc' ? 'desc' : 'asc',
                });
            } else {
                setLinkTableSortState({ column: col, direction: 'asc' });
            }
            renderDetailPanel();
        });
    }

    return {
        renderDetailPanel,
        setActiveTab,
        bindTabs,
    };
}

const exported = { createDetailPanel };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
