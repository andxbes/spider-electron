/**
 * Table filter state, DOM sync, and filtered result queries.
 */
(function initTableFilters(root) {
if (typeof require !== 'undefined') {
    try {
        require('../shared/redirect-chain');
    } catch {
        // redirect-chain.js підключається окремим <script> у renderer
    }
}
const CONTENT_TYPE_TABS = [
    { value: 'all', label: 'Усі' },
    { value: 'html', label: 'HTML' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'css', label: 'CSS' },
    { value: 'media', label: 'Media' },
];

function createTableFilters(deps) {
    const {
        scanStore,
        getUiState,
        getScanHostname,
        getSortState,
        setSortState,
        elements,
        onFilterChange,
        onPersistWorkspace,
        isExternalLink,
        compareRowsImpl,
        getRowMetrics,
        invalidateDuplicateCounts,
        sanitizeSortState,
    } = deps;

    const {
        contentTypeTabs,
        statusFilter,
        indexingFilter,
        h1Filter,
        duplicateFilter,
        sourceFilter,
        tableSearch,
    } = elements;

    let activeContentFilter = 'all';
    let activeStatusFilter = 'all';
    let activeIndexingFilter = 'all';
    let activeH1Filter = 'all';
    let activeDuplicateFilter = 'all';
    let activeSourceFilter = 'all';
    let activeSearchQuery = '';
    let knownStatusCodes = new Set();
    let searchRefreshTimer = null;
    const SEARCH_REFRESH_DELAY_MS = 200;

    function setActiveContentFilter(value) {
        activeContentFilter = normalizeContentTypeFilter(value);
        syncContentTypeTabsUi();
    }

    function setActiveSourceFilter(value) {
        activeSourceFilter = normalizeSourceFilter(value || 'all');
        if (sourceFilter) {
            sourceFilter.value = activeSourceFilter;
        }
    }

    function syncContentTypeTabsUi() {
        if (contentTypeTabs) {
            contentTypeTabs.querySelectorAll('.content-type-tab').forEach((btn) => {
                const isActive = btn.dataset.content === activeContentFilter;
                btn.classList.toggle('border-blue-600', isActive);
                btn.classList.toggle('text-blue-700', isActive);
                btn.classList.toggle('bg-white', isActive);
                btn.classList.toggle('border-transparent', !isActive);
                btn.classList.toggle('text-zinc-600', !isActive);
            });
        }
    }

    function applyActiveFiltersToDom() {
        syncContentTypeTabsUi();
        if (sourceFilter && sourceFilter.value !== activeSourceFilter) {
            sourceFilter.value = activeSourceFilter;
        }
    }

    function getScannableTablePool() {
        const all = Array.from(scanStore.scanResults.values());
        if (getUiState() === 'running') {
            return all.filter((data) => data.fetched !== false);
        }
        return all;
    }

    function getTableEntries() {
        const pool = getScannableTablePool();
        const visible = pool.filter((data) => shouldShowInResultsTable(data, pool));
        if (activeContentFilter === 'all') {
            return visible;
        }
        return visible.filter((data) => matchesResourceTypeFilterImpl(data, activeContentFilter));
    }

    function getFilteredResults() {
        return getTableEntries().filter((data) => passesTableFiltersImpl(data, {
            activeSearchQuery,
            activeSourceFilter,
            activeStatusFilter,
            activeIndexingFilter,
            activeH1Filter,
            activeDuplicateFilter,
            activeContentFilter,
            scanHostname: getScanHostname(),
            getDuplicateCounts: () => scanStore.getDuplicateCounts(),
            getReferrersForUrl: (url) => scanStore.getReferrersForUrl(url),
        }));
    }

    function getDisplayedResults() {
        const entries = getFilteredResults();
        const sortState = getSortState();
        const sortHelpers = {
            getRowMetrics,
            getReferrersForUrl: (url) => scanStore.getReferrersForUrl(url),
        };
        if (sortState.column) {
            entries.sort((a, b) => compareRowsImpl(
                a,
                b,
                sortState,
                scanStore.insertionOrder,
                sortHelpers,
            ));
        } else if (activeContentFilter === 'media') {
            entries.sort((a, b) => compareRowsImpl(
                a,
                b,
                { column: 'alt', direction: 'asc' },
                scanStore.insertionOrder,
                sortHelpers,
            ));
        } else {
            entries.sort((a, b) => (
                scanStore.insertionOrder.indexOf(a.url) - scanStore.insertionOrder.indexOf(b.url)
            ));
        }
        return entries;
    }

    function areDefaultTableFiltersActive() {
        return activeContentFilter === 'all'
            && activeSourceFilter === 'all'
            && activeStatusFilter === 'all'
            && activeIndexingFilter === 'all'
            && activeH1Filter === 'all'
            && activeDuplicateFilter === 'all'
            && !activeSearchQuery.trim()
            && !getSortState().column;
    }

    function hasActiveLinkFilters() {
        return activeSourceFilter !== 'all' || activeContentFilter !== 'all';
    }

    function getFilteredOutgoingLinks(pageUrl, getOutgoingLinksFrom) {
        let links = getOutgoingLinksFrom(pageUrl);
        if (activeSourceFilter === 'external') {
            links = links.filter((link) => isExternalLink(link));
        } else if (activeSourceFilter === 'internal') {
            links = links.filter((link) => !isExternalLink(link));
        }
        if (activeContentFilter !== 'all') {
            links = links.filter((data) => matchesResourceTypeFilterImpl(data, activeContentFilter));
        }
        return links;
    }

    function updateStatusFilterOptions({ force = false } = {}) {
        if (!statusFilter) {
            return;
        }

        const numericStatuses = new Set();
        for (const data of scanStore.scanResults.values()) {
            if (typeof data.status === 'number') {
                numericStatuses.add(data.status);
            }
        }

        const statusesUnchanged = !force
            && numericStatuses.size === knownStatusCodes.size
            && [...numericStatuses].every((code) => knownStatusCodes.has(code));
        if (statusesUnchanged) {
            return;
        }
        knownStatusCodes = numericStatuses;

        const staticOptions = [
            { value: 'all', label: 'Усі' },
            { value: '2xx', label: '2xx' },
            { value: '3xx', label: '3xx' },
            { value: '4xx', label: '4xx' },
            { value: '5xx', label: '5xx' },
            { value: 'ERROR', label: 'Помилка мережі' },
        ];

        const exactOptions = [...numericStatuses].sort((a, b) => a - b).map((code) => ({
            value: String(code),
            label: String(code),
        }));

        statusFilter.innerHTML = '';

        const defaultGroup = document.createElement('optgroup');
        defaultGroup.label = 'Групи';
        for (const option of staticOptions) {
            const el = document.createElement('option');
            el.value = option.value;
            el.textContent = option.label;
            defaultGroup.appendChild(el);
        }
        statusFilter.appendChild(defaultGroup);

        if (exactOptions.length > 0) {
            const exactGroup = document.createElement('optgroup');
            exactGroup.label = 'Точний код';
            for (const option of exactOptions) {
                const el = document.createElement('option');
                el.value = option.value;
                el.textContent = option.label;
                exactGroup.appendChild(el);
            }
            statusFilter.appendChild(exactGroup);
        }

        const hasCurrent = [...statusFilter.options].some((opt) => opt.value === activeStatusFilter);
        if (!hasCurrent) {
            activeStatusFilter = 'all';
        }
        statusFilter.value = activeStatusFilter;
    }

    function resetTableFilters() {
        activeStatusFilter = 'all';
        activeIndexingFilter = 'all';
        activeH1Filter = 'all';
        activeDuplicateFilter = 'all';
        activeSearchQuery = '';
        setActiveSourceFilter('all');
        setActiveContentFilter('all');
        knownStatusCodes = new Set();
        invalidateDuplicateCounts();
        if (tableSearch) {
            tableSearch.value = '';
        }
        if (statusFilter) {
            statusFilter.value = 'all';
        }
        if (indexingFilter) {
            indexingFilter.value = 'all';
        }
        if (h1Filter) {
            h1Filter.value = 'all';
        }
        if (duplicateFilter) {
            duplicateFilter.value = 'all';
        }
        updateStatusFilterOptions({ force: true });
    }

    function applyFilterState(filters) {
        activeStatusFilter = filters.status || 'all';
        activeIndexingFilter = filters.indexing || 'all';
        activeH1Filter = filters.h1 || 'all';
        activeDuplicateFilter = filters.duplicate || 'all';
        setActiveSourceFilter(filters.source || filters.viewMode || filters.externalLinks || 'all');
        setActiveContentFilter(filters.content || filters.externalType || 'all');
        activeSearchQuery = filters.search || '';
        if (tableSearch) {
            tableSearch.value = activeSearchQuery;
        }
        if (statusFilter) {
            statusFilter.value = activeStatusFilter;
        }
        if (indexingFilter) {
            indexingFilter.value = activeIndexingFilter;
        }
        if (h1Filter) {
            h1Filter.value = activeH1Filter;
        }
        if (duplicateFilter) {
            duplicateFilter.value = activeDuplicateFilter;
        }
        updateStatusFilterOptions({ force: true });
    }

    function getFilterSnapshot() {
        return {
            content: activeContentFilter,
            status: activeStatusFilter,
            indexing: activeIndexingFilter,
            h1: activeH1Filter,
            duplicate: activeDuplicateFilter,
            source: activeSourceFilter,
            search: activeSearchQuery,
        };
    }

    function scheduleSearchRefresh() {
        if (searchRefreshTimer) {
            return;
        }
        searchRefreshTimer = setTimeout(() => {
            searchRefreshTimer = null;
            onFilterChange({ immediate: true });
            if (typeof onPersistWorkspace === 'function') {
                onPersistWorkspace();
            }
        }, SEARCH_REFRESH_DELAY_MS);
    }

    function onTableSortChange(col) {
        const sortState = getSortState();
        if (sortState.column === col) {
            setSortState({
                column: col,
                direction: sortState.direction === 'asc' ? 'desc' : 'asc',
            });
        } else {
            setSortState({ column: col, direction: 'asc' });
        }
        deps.onTableHeadRefresh();
        onFilterChange({ immediate: true });
    }

    function onContentTypeTabChange(nextValue) {
        if (activeContentFilter === nextValue) {
            return;
        }
        setActiveContentFilter(nextValue);
        if (typeof sanitizeSortState === 'function') {
            sanitizeSortState();
        }
        onFilterChange({ immediate: true });
        if (typeof onPersistWorkspace === 'function') {
            onPersistWorkspace();
        }
    }

    function bindFilterControls() {
        if (contentTypeTabs) {
            contentTypeTabs.addEventListener('click', (event) => {
                const btn = event.target.closest('.content-type-tab');
                if (!btn?.dataset.content) {
                    return;
                }
                onContentTypeTabChange(btn.dataset.content);
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener('change', () => {
                activeStatusFilter = statusFilter.value;
                onFilterChange({ immediate: true });
            });
        }

        if (indexingFilter) {
            indexingFilter.addEventListener('change', () => {
                activeIndexingFilter = indexingFilter.value;
                onFilterChange({ immediate: true });
            });
        }

        if (h1Filter) {
            h1Filter.addEventListener('change', () => {
                activeH1Filter = h1Filter.value;
                onFilterChange({ immediate: true });
            });
        }

        if (duplicateFilter) {
            duplicateFilter.addEventListener('change', () => {
                activeDuplicateFilter = duplicateFilter.value;
                onFilterChange({ immediate: true });
            });
        }

        if (sourceFilter) {
            sourceFilter.addEventListener('change', () => {
                setActiveSourceFilter(sourceFilter.value);
                onFilterChange({ immediate: true });
                if (typeof onPersistWorkspace === 'function') {
                    onPersistWorkspace();
                }
            });
        }

        if (tableSearch) {
            tableSearch.addEventListener('input', () => {
                activeSearchQuery = tableSearch.value;
                scheduleSearchRefresh();
            });
            tableSearch.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    tableSearch.value = '';
                    activeSearchQuery = '';
                    onFilterChange({ immediate: true });
                    if (typeof onPersistWorkspace === 'function') {
                        onPersistWorkspace();
                    }
                }
            });
        }
    }

    syncContentTypeTabsUi();

    return {
        getScannableTablePool,
        getTableEntries,
        getFilteredResults,
        getDisplayedResults,
        areDefaultTableFiltersActive,
        hasActiveLinkFilters,
        getFilteredOutgoingLinks,
        getActiveContentFilter: () => activeContentFilter,
        updateStatusFilterOptions,
        resetTableFilters,
        applyFilterState,
        getFilterSnapshot,
        bindFilterControls,
        onTableSortChange,
        setActiveContentFilter,
        setActiveSourceFilter,
    };
}

const exported = { createTableFilters, CONTENT_TYPE_TABS };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
