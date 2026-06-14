/**
 * Results table: lazy rendering driven by ui:tableColumns hook.
 */
(function initTableView(root) {
const { resolveTableColumns } = root;

const TABLE_VISIBLE_INITIAL = 100;
const TABLE_LAZY_LOAD_SIZE = 50;
const TABLE_LAZY_SCROLL_THRESHOLD_PX = 160;
const REFRESH_TABLE_DELAY_MS = 250;
const STATUS_FILTER_REFRESH_EVERY_N_PAGES = 100;

function createTableView(deps) {
    const {
        resultsTable,
        pagesTableScroll,
        filterCount,
        detailContent,
        getDisplayedResults,
        getTableEntries,
        getRowData,
        getUiState,
        areDefaultTableFiltersActive,
        updateStatusFilterOptions,
        updateExportButton,
        syncSelectedRowUi,
        getSelectedUrl,
        urlCellHtml,
        onSelectRow,
    } = deps;

    let tableDisplayEntries = [];
    let tableRenderedCount = 0;
    let tableLazyLoadToken = 0;
    let tableScrollRaf = null;
    let renderedTableUrlSet = new Set();
    let refreshTableTimer = null;

    function getTableContext() {
        return {
            helpers: deps.getTableHelpers(),
            sortState: deps.getSortState(),
        };
    }

    function getColumns() {
        return resolveTableColumns(getTableContext());
    }

    function createTableRow(data, displayIndex) {
        const columns = getColumns();
        const tr = document.createElement('tr');
        tr.dataset.url = data.url;
        tr.className = 'border-b border-zinc-100 cursor-pointer hover:bg-zinc-50';
        if (getSelectedUrl() === data.url) {
            tr.classList.add('bg-blue-50');
        }
        tr.innerHTML = columns.map((col) => col.renderCell(data, getTableContext(), displayIndex)).join('');
        tr.addEventListener('click', (e) => {
            if (e.target.closest('.url-copy, .url-open')) {
                return;
            }
            onSelectRow(data.url);
        });
        return tr;
    }

    function updateFilterCount(filteredCount, poolSize, renderedCount = filteredCount) {
        if (!filterCount) {
            return;
        }
        const inTable = Math.min(renderedCount, filteredCount);
        if (inTable < filteredCount) {
            if (filteredCount === poolSize) {
                filterCount.textContent = `У таблиці: ${inTable} з ${filteredCount}`;
            } else {
                filterCount.textContent = `У таблиці: ${inTable} з ${filteredCount} (усього ${poolSize})`;
            }
            return;
        }
        if (filteredCount === poolSize) {
            filterCount.textContent = poolSize > 0 ? `Усього: ${poolSize}` : '';
        } else {
            filterCount.textContent = `Показано: ${filteredCount} з ${poolSize}`;
        }
    }

    function finishTableRefresh(entries, poolSize, { incremental = false } = {}) {
        updateFilterCount(entries.length, poolSize, tableRenderedCount);
        const uiState = getUiState();
        if (uiState === 'idle' || uiState === 'paused') {
            updateExportButton();
        }

        const selectedUrl = getSelectedUrl();
        if (selectedUrl && !entries.some((row) => row.url === selectedUrl)) {
            document.querySelectorAll('#resultsTable tr').forEach((tr) => {
                tr.classList.remove('bg-blue-50');
            });
            detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Сторінка не відповідає поточним фільтрам</p>';
        } else if (selectedUrl && getRowData(selectedUrl) && !incremental) {
            syncSelectedRowUi();
        }
    }

    function appendTableRows(entries, startIndex, endIndex) {
        for (let i = startIndex; i < endIndex; i++) {
            const data = entries[i];
            if (renderedTableUrlSet.has(data.url)) {
                continue;
            }
            resultsTable.appendChild(createTableRow(data, i + 1));
            renderedTableUrlSet.add(data.url);
        }
    }

    function loadMoreTableRows() {
        if (tableRenderedCount >= tableDisplayEntries.length) {
            return;
        }
        const start = tableRenderedCount;
        const end = Math.min(start + TABLE_LAZY_LOAD_SIZE, tableDisplayEntries.length);
        if (start >= end) {
            return;
        }
        appendTableRows(tableDisplayEntries, start, end);
        tableRenderedCount = end;
        updateFilterCount(
            tableDisplayEntries.length,
            getTableEntries().length,
            tableRenderedCount
        );
    }

    function maybeLoadMoreTableRows() {
        if (!pagesTableScroll || tableRenderedCount >= tableDisplayEntries.length) {
            return;
        }
        const { scrollTop, clientHeight, scrollHeight } = pagesTableScroll;
        if (scrollTop + clientHeight < scrollHeight - TABLE_LAZY_SCROLL_THRESHOLD_PX) {
            return;
        }
        loadMoreTableRows();
    }

    function renderTableInitialChunk(entries) {
        tableLazyLoadToken += 1;
        tableDisplayEntries = entries;
        renderedTableUrlSet = new Set();
        resultsTable.innerHTML = '';
        tableRenderedCount = Math.min(TABLE_VISIBLE_INITIAL, entries.length);
        if (tableRenderedCount > 0) {
            appendTableRows(entries, 0, tableRenderedCount);
        }
        if (pagesTableScroll) {
            pagesTableScroll.scrollTop = 0;
        }
    }

    function refreshTableIncremental(entries, poolSize) {
        tableDisplayEntries = entries;

        if (tableRenderedCount < TABLE_VISIBLE_INITIAL) {
            const target = Math.min(TABLE_VISIBLE_INITIAL, entries.length);
            appendTableRows(entries, tableRenderedCount, target);
            tableRenderedCount = target;
        }

        finishTableRefresh(entries, poolSize, { incremental: true });
    }

    function canIncrementallyRefreshTable() {
        return getUiState() === 'running' && areDefaultTableFiltersActive();
    }

    function refreshTable() {
        const incremental = canIncrementallyRefreshTable();
        if (!incremental || deps.getScanResultsSize() % STATUS_FILTER_REFRESH_EVERY_N_PAGES === 0) {
            updateStatusFilterOptions();
        }

        const entries = getDisplayedResults();
        const poolSize = getTableEntries().length;

        if (incremental) {
            refreshTableIncremental(entries, poolSize);
            return;
        }

        if (entries.length === 0) {
            tableDisplayEntries = [];
            tableRenderedCount = 0;
            renderedTableUrlSet = new Set();
            resultsTable.innerHTML = '';
            finishTableRefresh(entries, poolSize);
            return;
        }

        renderTableInitialChunk(entries);
        finishTableRefresh(entries, poolSize);
    }

    function requestRefreshTable({ immediate = false } = {}) {
        if (immediate) {
            if (refreshTableTimer) {
                clearTimeout(refreshTableTimer);
                refreshTableTimer = null;
            }
            refreshTable();
            return;
        }

        if (refreshTableTimer) {
            return;
        }

        const delay = getUiState() === 'running' ? REFRESH_TABLE_DELAY_MS : 0;
        refreshTableTimer = setTimeout(() => {
            refreshTableTimer = null;
            refreshTable();
        }, delay);
    }

    function cancelPendingRefreshTable() {
        if (refreshTableTimer) {
            clearTimeout(refreshTableTimer);
            refreshTableTimer = null;
        }
        tableLazyLoadToken += 1;
    }

    function resetTableRenderCache() {
        renderedTableUrlSet = new Set();
        tableDisplayEntries = [];
        tableRenderedCount = 0;
        tableLazyLoadToken += 1;
    }

    function bindScroll() {
        if (!pagesTableScroll) {
            return;
        }
        pagesTableScroll.addEventListener('scroll', () => {
            if (tableScrollRaf) {
                return;
            }
            tableScrollRaf = requestAnimationFrame(() => {
                tableScrollRaf = null;
                maybeLoadMoreTableRows();
            });
        });
    }

    function updateSortIndicators() {
        const sortState = deps.getSortState();
        document.querySelectorAll('.sortable-th').forEach((th) => {
            const col = th.dataset.sort;
            const base = th.textContent.replace(/ [▲▼]$/, '');
            if (sortState.column === col) {
                th.textContent = `${base} ${sortState.direction === 'asc' ? '▲' : '▼'}`;
                th.classList.add('bg-zinc-200', 'text-zinc-800');
            } else {
                th.textContent = base;
                th.classList.remove('bg-zinc-200', 'text-zinc-800');
            }
        });
    }

    return {
        refreshTable,
        requestRefreshTable,
        cancelPendingRefreshTable,
        resetTableRenderCache,
        bindScroll,
        updateSortIndicators,
        getColumns,
    };
}

const exported = { createTableView };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
