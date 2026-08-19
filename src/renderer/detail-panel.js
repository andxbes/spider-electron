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

    const focusedLinkByContext = new Map();

    function getLinkRowUrl(link) {
        if (!link) {
            return '';
        }
        if (typeof link === 'string') {
            return link;
        }
        return link.url || link.href || '';
    }

    function getFocusContextKey() {
        const tab = getActiveTab();
        const pageUrl = getSelectedUrl() || '';
        return `${tab}\t${pageUrl}`;
    }

    function getFocusedLinkUrl() {
        return focusedLinkByContext.get(getFocusContextKey()) || '';
    }

    function setFocusedLinkUrl(url) {
        const key = getFocusContextKey();
        if (!url) {
            focusedLinkByContext.delete(key);
            return;
        }
        focusedLinkByContext.set(key, url);
    }

    function clearFocusedLinks() {
        focusedLinkByContext.clear();
    }

    function getLinkTableRows() {
        if (!detailContent?.querySelectorAll) {
            return [];
        }
        return Array.from(detailContent.querySelectorAll('.detail-links-table tbody tr[data-url]'));
    }

    function syncFocusedLinkHighlight({ scroll = false, focusRow = false } = {}) {
        const focusedUrl = getFocusedLinkUrl();
        let focusedRow = null;
        for (const tr of getLinkTableRows()) {
            const isFocused = Boolean(focusedUrl) && tr.dataset.url === focusedUrl;
            tr.classList.toggle('detail-link-focused', isFocused);
            if (isFocused) {
                focusedRow = tr;
            }
        }
        if (!focusedRow) {
            return;
        }
        if (scroll && typeof focusedRow.scrollIntoView === 'function') {
            focusedRow.scrollIntoView({ block: 'nearest' });
        }
        if (focusRow && typeof focusedRow.focus === 'function') {
            focusedRow.focus();
        }
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
        const focusedUrl = getFocusedLinkUrl();
        const rows = sortLinkRows(links)
            .map(
                (link) => {
                    const rowUrl = getLinkRowUrl(link);
                    const focused = Boolean(rowUrl) && rowUrl === focusedUrl;
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
                    const rowClass = [
                        'border-b border-zinc-100',
                        external ? 'detail-link-external' : '',
                        focused ? 'detail-link-focused' : '',
                    ].filter(Boolean).join(' ');
                    return `
        <tr class="${rowClass}" data-url="${escapeHtml(rowUrl)}" tabindex="-1">
            <td class="p-2 detail-link-col-url">${urlCellHtml(rowUrl)}${typeBadge}</td>
            <td class="p-2 font-mono text-zinc-600 text-[11px] detail-link-col-tag whitespace-nowrap">${escapeHtml(tag)}</td>
            <td class="p-2 text-zinc-600 detail-link-col-rel">${relCell}</td>
            <td class="p-2 whitespace-nowrap detail-link-col-follow">${formatRelAllowedStatus(relInfo.relFollowAllowed)}</td>
            <td class="p-2 text-zinc-600 detail-link-col-text">${link.text ? escapeHtml(link.text) : '<span class="text-zinc-400 italic">—</span>'}</td>
        </tr>`;
                }
            )
            .join('');
        const sortThClass = 'sortable-link-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200';
        const activeSortClass = (column) => (
            linkTableSortState.column === column ? ' bg-zinc-200 text-zinc-800' : ''
        );
        return `${captionHtml}<table class="detail-links-table w-full border-collapse">
        <thead class="bg-zinc-50 sticky top-0">
            <tr class="text-left text-zinc-500">
                <th class="${sortThClass} detail-link-col-url${activeSortClass('url')}" data-sort="url" title="URL">${linkTableSortIndicator('url', 'URL', linkTableSortState)}</th>
                <th class="${sortThClass} detail-link-col-tag${activeSortClass('tag')}" data-sort="tag" title="Тег">${linkTableSortIndicator('tag', 'Тег', linkTableSortState)}</th>
                <th class="${sortThClass} detail-link-col-rel${activeSortClass('rel')}" data-sort="rel" title="rel">${linkTableSortIndicator('rel', 'rel', linkTableSortState)}</th>
                <th class="${sortThClass} detail-link-col-follow${activeSortClass('follow')}" data-sort="follow" title="Перехід">${linkTableSortIndicator('follow', 'Перехід', linkTableSortState)}</th>
                <th class="${sortThClass} detail-link-col-text${activeSortClass('text')}" data-sort="text" title="Текст посилання">${linkTableSortIndicator('text', 'Текст посилання', linkTableSortState)}</th>
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
            syncFocusedLinkHighlight({ scroll: true });
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
            syncFocusedLinkHighlight({ scroll: true });
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
            if (th) {
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
                return;
            }
            const row = event.target.closest('.detail-links-table tbody tr[data-url]');
            if (!row?.dataset.url) {
                return;
            }
            setFocusedLinkUrl(row.dataset.url);
            syncFocusedLinkHighlight({ focusRow: true });
        });

        detailContent.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
                return;
            }
            if (!event.target.closest?.('.detail-links-table')) {
                return;
            }
            const rows = getLinkTableRows();
            if (!rows.length) {
                return;
            }
            const current = event.target.closest('tr[data-url]')
                || rows.find((tr) => tr.dataset.url === getFocusedLinkUrl());
            const index = current ? rows.indexOf(current) : -1;
            const nextIndex = event.key === 'ArrowDown'
                ? Math.min((index < 0 ? 0 : index + 1), rows.length - 1)
                : Math.max((index < 0 ? 0 : index - 1), 0);
            const next = rows[nextIndex];
            if (!next || next === current) {
                event.preventDefault();
                return;
            }
            event.preventDefault();
            setFocusedLinkUrl(next.dataset.url);
            syncFocusedLinkHighlight({ scroll: true, focusRow: true });
        });
    }

    return {
        renderDetailPanel,
        setActiveTab,
        bindTabs,
        clearFocusedLinks,
    };
}

const exported = { createDetailPanel };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
