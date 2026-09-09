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
        compareRowsImpl,
        getRowMetrics,
        invalidateDuplicateCounts,
        sanitizeSortState,
    } = deps;

    const {
        contentTypeTabs,
        statusFilter,
        indexingFilter,
        sourceFilter,
        domainFilter,
        issueFilter,
        tableSearch,
    } = elements;

    let activeContentFilter = 'all';
    let activeStatusFilter = 'all';
    let activeIndexingFilter = 'all';
    let activeIssueFilter = 'all';
    let activeSourceFilter = 'all';
    let activeDomainFilter = 'all';
    let activeSearchQuery = '';
    let knownStatusCodes = new Set();
    let knownDomainHosts = new Set();
    let searchRefreshTimer = null;
    const SEARCH_REFRESH_DELAY_MS = 200;
    let displayedResultsCache = null;

    function invalidateDisplayedResultsCache() {
        displayedResultsCache = null;
    }

    function getDisplayedResultsCacheKey() {
        const sortState = getSortState();
        return [
            scanStore.getDataRevision?.() ?? scanStore.scanResults.size,
            scanStore.scanResults.size,
            getUiState(),
            activeContentFilter,
            activeStatusFilter,
            activeIndexingFilter,
            activeIssueFilter,
            activeSourceFilter,
            activeDomainFilter,
            activeSearchQuery,
            sortState.column || '',
            sortState.direction || '',
        ].join('\0');
    }

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

    function setActiveDomainFilter(value) {
        activeDomainFilter = normalizeDomainFilter(value || 'all');
        if (domainFilter) {
            const hasOption = [...domainFilter.options].some((opt) => opt.value === activeDomainFilter);
            domainFilter.value = hasOption ? activeDomainFilter : 'all';
            if (domainFilter.value !== activeDomainFilter) {
                activeDomainFilter = 'all';
            }
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
        if (domainFilter && domainFilter.value !== activeDomainFilter) {
            const hasOption = [...domainFilter.options].some((opt) => opt.value === activeDomainFilter);
            domainFilter.value = hasOption ? activeDomainFilter : 'all';
        }
        if (issueFilter && issueFilter.value !== activeIssueFilter) {
            issueFilter.value = activeIssueFilter;
        }
    }

    function getScannableTablePool() {
        const all = Array.from(scanStore.scanResults.values());
        if (getUiState() === 'running') {
            return all.filter((data) => data.fetched !== false);
        }
        return all;
    }

    function getTableEntries(pool = getScannableTablePool(), redirectIntermediates = null) {
        const intermediates = redirectIntermediates || buildRedirectIntermediateUrlSet(pool);
        const visible = pool.filter((data) => shouldShowInResultsTable(data, intermediates));
        if (activeContentFilter === 'all') {
            return visible;
        }
        return visible.filter((data) => matchesResourceTypeFilterImpl(data, activeContentFilter));
    }

    function getFilteredResults(tableEntries = null) {
        const entries = tableEntries ?? getTableEntries();
        return entries.filter((data) => passesTableFiltersImpl(data, {
            activeSearchQuery,
            activeSourceFilter,
            activeDomainFilter,
            activeStatusFilter,
            activeIndexingFilter,
            activeIssueFilter,
            activeContentFilter,
            scanHostname: getScanHostname(),
            getDuplicateCounts: () => scanStore.getDuplicateCounts(),
            getReferrersForUrl: (url) => scanStore.getReferrersForUrl(url),
            getOutgoingLinksFrom: (url) => scanStore.getOutgoingLinksFrom(url),
        }));
    }

    function sortDisplayedEntries(entries) {
        const sortState = getSortState();
        const sortHelpers = {
            getRowMetrics,
            getReferrersForUrl: (url) => scanStore.getReferrersForUrl(url),
            getOutgoingLinksFrom: (url) => scanStore.getOutgoingLinksFrom(url),
            getInsertionIndex: (url) => scanStore.getInsertionIndex(url),
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
            const orderIndex = scanStore.insertionOrderIndex;
            entries.sort((a, b) => {
                const ia = orderIndex.get(a.url) ?? Number.MAX_SAFE_INTEGER;
                const ib = orderIndex.get(b.url) ?? Number.MAX_SAFE_INTEGER;
                return ia - ib;
            });
        }
        return entries;
    }

    function computeDisplayedResultsSnapshot() {
        const pool = getScannableTablePool();

        const sortState = getSortState();
        const hasNoActiveFilters = activeContentFilter === 'all'
            && activeSourceFilter === 'all'
            && activeDomainFilter === 'all'
            && activeStatusFilter === 'all'
            && activeIndexingFilter === 'all'
            && activeIssueFilter === 'all'
            && !activeSearchQuery.trim();
        const hasNoSort = !sortState.column
            && activeContentFilter !== 'media';

        if (hasNoActiveFilters && hasNoSort) {
            const redirectIntermediates = buildRedirectIntermediateUrlSet(pool);
            const entries = pool.filter((data) => shouldShowInResultsTable(data, redirectIntermediates));
            return {
                entries,
                poolSize: entries.length,
                displayedUrlSet: null,
            };
        }

        const redirectIntermediates = buildRedirectIntermediateUrlSet(pool);
        const tableEntries = getTableEntries(pool, redirectIntermediates);
        const filtered = getFilteredResults(tableEntries);
        const entries = sortDisplayedEntries(filtered);
        return {
            entries,
            poolSize: tableEntries.length,
            displayedUrlSet: new Set(entries.map((entry) => entry.url)),
        };
    }

    function getDisplayedResultsSnapshot() {
        const cacheKey = getDisplayedResultsCacheKey();
        if (displayedResultsCache?.key === cacheKey) {
            return displayedResultsCache.snapshot;
        }
        const snapshot = computeDisplayedResultsSnapshot();
        displayedResultsCache = { key: cacheKey, snapshot };
        return snapshot;
    }

    function getDisplayedResults() {
        return getDisplayedResultsSnapshot().entries;
    }

    function getCachedDisplayedCount() {
        return getDisplayedResultsSnapshot().entries.length;
    }

    function getCachedPoolSize() {
        return getDisplayedResultsSnapshot().poolSize;
    }

    function isUrlInDisplayedResults(url) {
        const snapshot = getDisplayedResultsSnapshot();
        if (snapshot.displayedUrlSet === null) {
            return scanStore.scanResults.has(url);
        }
        return snapshot.displayedUrlSet.has(url);
    }

    function areDefaultTableFiltersActive() {
        return activeContentFilter === 'all'
            && activeSourceFilter === 'all'
            && activeDomainFilter === 'all'
            && activeStatusFilter === 'all'
            && activeIndexingFilter === 'all'
            && activeIssueFilter === 'all'
            && !activeSearchQuery.trim()
            && !getSortState().column;
    }

    function hasActiveLinkFilters() {
        return activeSourceFilter !== 'all'
            || activeDomainFilter !== 'all'
            || activeContentFilter !== 'all'
            || activeIssueFilter === 'ext-a-follow';
    }

    function getFilteredOutgoingLinks(pageUrl, getOutgoingLinksFrom) {
        let links = getOutgoingLinksFrom(pageUrl);
        const scanHostname = typeof getScanHostname === 'function' ? getScanHostname() : '';
        if (activeSourceFilter !== 'all') {
            links = links.filter((link) => getLinkSourceKind(link, scanHostname) === activeSourceFilter);
        }
        if (activeDomainFilter !== 'all') {
            links = links.filter((link) => passesDomainFilterForRowImpl(link, activeDomainFilter));
        }
        if (activeContentFilter !== 'all') {
            links = links.filter((data) => matchesResourceTypeFilterImpl(data, activeContentFilter));
        }
        if (activeIssueFilter === 'ext-a-follow') {
            links = links.filter((link) => isOffSiteFollowAnchor(link, scanHostname));
        }
        return links;
    }

    function isSelectFocused(el) {
        return typeof document !== 'undefined' && document.activeElement === el;
    }

    function updateStatusFilterOptions({ force = false } = {}) {
        updateDomainFilterOptions({ force });
        if (!statusFilter) {
            return;
        }
        if (!force && isSelectFocused(statusFilter)) {
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

    function appendDomainFilterGroup(label, hosts) {
        if (!domainFilter || !hosts.length) {
            return;
        }
        const group = document.createElement('optgroup');
        group.label = label;
        for (const host of hosts) {
            const el = document.createElement('option');
            el.value = host;
            el.textContent = host;
            group.appendChild(el);
        }
        domainFilter.appendChild(group);
    }

    function updateDomainFilterOptions({ force = false } = {}) {
        if (!domainFilter) {
            return;
        }
        if (!force && typeof document !== 'undefined' && document.activeElement === domainFilter) {
            return;
        }

        const grouped = collectScanHostnames(scanStore.scanResults.values(), getScanHostname());
        const nextHosts = new Set([
            ...grouped.internal,
            ...grouped.subdomains,
            ...grouped.external,
        ]);
        const hostsUnchanged = !force
            && nextHosts.size === knownDomainHosts.size
            && [...nextHosts].every((host) => knownDomainHosts.has(host));
        if (hostsUnchanged) {
            return;
        }
        knownDomainHosts = nextHosts;

        domainFilter.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'Усі';
        domainFilter.appendChild(allOption);

        appendDomainFilterGroup('Скан', grouped.internal);
        appendDomainFilterGroup('Піддомени', grouped.subdomains);
        appendDomainFilterGroup('Зовнішні', grouped.external);

        const hasCurrent = [...domainFilter.options].some((opt) => opt.value === activeDomainFilter);
        if (!hasCurrent) {
            activeDomainFilter = 'all';
        }
        domainFilter.value = activeDomainFilter;
    }

    function resetTableFilters() {
        activeStatusFilter = 'all';
        activeIndexingFilter = 'all';
        activeIssueFilter = 'all';
        activeSearchQuery = '';
        setActiveSourceFilter('all');
        setActiveDomainFilter('all');
        setActiveContentFilter('all');
        knownStatusCodes = new Set();
        knownDomainHosts = new Set();
        invalidateDisplayedResultsCache();
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
        if (issueFilter) {
            issueFilter.value = 'all';
        }
        if (domainFilter) {
            domainFilter.value = 'all';
        }
        updateStatusFilterOptions({ force: true });
        updateDomainFilterOptions({ force: true });
    }

    function applyFilterState(filters) {
        activeStatusFilter = filters.status || 'all';
        activeIndexingFilter = filters.indexing || 'all';
        activeIssueFilter = resolveIssueFilter(filters);
        setActiveSourceFilter(filters.source || filters.viewMode || filters.externalLinks || 'all');
        setActiveContentFilter(filters.content || filters.externalType || 'all');
        activeSearchQuery = filters.search || '';
        invalidateDisplayedResultsCache();
        if (tableSearch) {
            tableSearch.value = activeSearchQuery;
        }
        if (statusFilter) {
            statusFilter.value = activeStatusFilter;
        }
        if (indexingFilter) {
            indexingFilter.value = activeIndexingFilter;
        }
        if (issueFilter) {
            issueFilter.value = activeIssueFilter;
        }
        updateStatusFilterOptions({ force: true });
        updateDomainFilterOptions({ force: true });
        setActiveDomainFilter(filters.domain || 'all');
    }

    function getFilterSnapshot() {
        return {
            content: activeContentFilter,
            status: activeStatusFilter,
            indexing: activeIndexingFilter,
            issue: activeIssueFilter,
            source: activeSourceFilter,
            domain: activeDomainFilter,
            search: activeSearchQuery,
        };
    }

    function scheduleSearchRefresh() {
        if (searchRefreshTimer) {
            return;
        }
        searchRefreshTimer = setTimeout(() => {
            searchRefreshTimer = null;
            invalidateDisplayedResultsCache();
            onFilterChange();
            if (typeof onPersistWorkspace === 'function') {
                onPersistWorkspace();
            }
        }, SEARCH_REFRESH_DELAY_MS);
    }

    function scheduleFilterRefresh() {
        invalidateDisplayedResultsCache();
        onFilterChange();
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
        scheduleFilterRefresh();
    }

    function onContentTypeTabChange(nextValue) {
        if (activeContentFilter === nextValue) {
            return;
        }
        setActiveContentFilter(nextValue);
        if (typeof sanitizeSortState === 'function') {
            sanitizeSortState();
        }
        scheduleFilterRefresh();
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
                scheduleFilterRefresh();
            });
        }

        if (indexingFilter) {
            indexingFilter.addEventListener('change', () => {
                activeIndexingFilter = indexingFilter.value;
                scheduleFilterRefresh();
            });
        }

        if (sourceFilter) {
            sourceFilter.addEventListener('change', () => {
                setActiveSourceFilter(sourceFilter.value);
                scheduleFilterRefresh();
                if (typeof onPersistWorkspace === 'function') {
                    onPersistWorkspace();
                }
            });
        }

        if (domainFilter) {
            domainFilter.addEventListener('change', () => {
                setActiveDomainFilter(domainFilter.value);
                scheduleFilterRefresh();
                if (typeof onPersistWorkspace === 'function') {
                    onPersistWorkspace();
                }
            });
        }

        if (issueFilter) {
            issueFilter.addEventListener('change', () => {
                activeIssueFilter = normalizeIssueFilter(issueFilter.value);
                issueFilter.value = activeIssueFilter;
                scheduleFilterRefresh();
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
                    scheduleFilterRefresh();
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
        getDisplayedResultsSnapshot,
        getCachedDisplayedCount,
        getCachedPoolSize,
        isUrlInDisplayedResults,
        invalidateDisplayedResultsCache,
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
