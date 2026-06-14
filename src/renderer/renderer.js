const urlInput = document.getElementById('urlInput');
const urlInputWrap = document.getElementById('urlInputWrap');
const urlInputProgress = document.getElementById('urlInputProgress');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const resumeButton = document.getElementById('resumeButton');
const restartButton = document.getElementById('restartButton');
const exportButton = document.getElementById('exportButton');
const controlsIdle = document.getElementById('controlsIdle');
const controlsRunning = document.getElementById('controlsRunning');
const controlsPaused = document.getElementById('controlsPaused');
const resultsTable = document.getElementById('resultsTable');
const resultsDataTable = document.getElementById('resultsDataTable');
const pagesTableHead = document.getElementById('pagesTableHead');
const pagesTableScroll = document.getElementById('pagesTableScroll');
const detailContent = document.getElementById('detailContent');
const selectedUrlHint = document.getElementById('selectedUrlHint');
const selectedUrlBar = document.getElementById('selectedUrlBar');
const statusText = document.getElementById('status-text');
const statusScanned = document.getElementById('status-scanned');
const statusQueue = document.getElementById('status-queue');
const statusActive = document.getElementById('status-active');
const statusRate = document.getElementById('status-rate');
const contentTypeFilter = document.getElementById('contentTypeFilter');
const statusFilter = document.getElementById('statusFilter');
const indexingFilter = document.getElementById('indexingFilter');
const h1Filter = document.getElementById('h1Filter');
const duplicateFilter = document.getElementById('duplicateFilter');
const sourceFilter = document.getElementById('sourceFilter');
const tableSearch = document.getElementById('tableSearch');
const filterCount = document.getElementById('filterCount');

let scanHostname = '';
const scanStore = createScanStore({
    getScanHostname: () => getScanHostname(),
});

function getPresentationHelpers() {
    return {
        urlCellHtml,
        getRowMetrics,
        getDuplicateCounts: () => scanStore.getDuplicateCounts(),
        getReferrersForUrl: (url) => scanStore.getReferrersForUrl(url),
        getOutgoingLinksFrom: (url) => scanStore.getOutgoingLinksFrom(url),
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
        getResourceType,
        formatCsvUrlListPreview,
    };
}

registerDefaultUiPresentations(getPresentationHelpers);

let selectedUrl = null;
let activeTab = 'details';
let sortState = { column: null, direction: 'asc' };
let linkTableSortState = { column: 'url', direction: 'asc' };
/** @type {'all' | 'html' | 'media'} */
let activeContentFilter = 'all';
/** @type {string} */
let activeStatusFilter = 'all';
/** @type {'all' | 'allowed' | 'blocked'} */
let activeIndexingFilter = 'all';
/** @type {'all' | 'multiple'} */
let activeH1Filter = 'all';
/** @type {'all' | 'h1' | 'title' | 'description'} */
let activeDuplicateFilter = 'all';
/** @type {'all' | 'internal' | 'external'} */
let activeSourceFilter = 'all';
let activeSearchQuery = '';
let searchRefreshTimer = null;
const SEARCH_REFRESH_DELAY_MS = 200;

let knownPresentContentTypesKey = '';
/** @type {'idle' | 'running' | 'paused'} */
let uiState = 'idle';
let knownStatusCodes = new Set();
let refreshTableTimer = null;
let scanRefreshTimer = null;
const REFRESH_TABLE_DELAY_MS = 250;
const SCAN_REFRESH_DELAY_MS = 400;
const STATUS_FILTER_REFRESH_EVERY_N_PAGES = 100;
const TABLE_VISIBLE_INITIAL = 100;
const TABLE_LAZY_LOAD_SIZE = 50;
const TABLE_LAZY_SCROLL_THRESHOLD_PX = 160;
let tableDisplayEntries = [];
let tableRenderedCount = 0;
let tableLazyLoadToken = 0;
let tableScrollRaf = null;
let lastScanProgress = null;
let workspacePersistTimer = null;
const WORKSPACE_PERSIST_DELAY_MS = 200;
let renderedTableUrlSet = new Set();

function isExternalUrl(url) {
    return isExternalUrlImpl(url, getScanHostname());
}

function isExternalLink(entry) {
    return isExternalLinkImpl(entry, getScanHostname());
}

function normalizeLinkEntry(data) {
    return normalizeLinkEntryImpl(data, getScanHostname());
}

function matchesResourceTypeFilter(data) {
    return matchesResourceTypeFilterImpl(data, activeContentFilter);
}

function passesSourceFilterForRow(data) {
    return passesSourceFilterForRowImpl(data, activeSourceFilter, getScanHostname());
}

function passesTableFilters(data) {
    return passesTableFiltersImpl(data, {
        activeSearchQuery,
        activeSourceFilter,
        activeStatusFilter,
        activeIndexingFilter,
        activeH1Filter,
        activeDuplicateFilter,
        activeContentFilter,
        scanHostname: getScanHostname(),
        getDuplicateCounts,
        getReferrersForUrl,
    });
}

function compareRows(a, b) {
    return compareRowsImpl(a, b, sortState, scanStore.insertionOrder);
}

function compareLinkRows(a, b) {
    return compareLinkRowsImpl(a, b, linkTableSortState);
}

function getRowMetrics(data) {
    return getRowMetricsImpl(data, {
        getReferrersForUrl,
        getOutgoingLinksFrom,
        isDiscoveredOnly,
        isExternalLink: (entry) => isExternalLinkImpl(entry, getScanHostname()),
        scanHostname: getScanHostname(),
    });
}



const RESOURCE_TYPE_FILTER_OPTIONS = [
    { value: 'all', label: 'Усі' },
    { value: 'html', label: 'HTML' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'css', label: 'CSS' },
    { value: 'media', label: 'Media (зображення, відео, аудіо)' },
];

function getReferrersForUrl(url) {
    return scanStore.getReferrersForUrl(url);
}

function getOutgoingLinksFrom(pageUrl) {
    return scanStore.getOutgoingLinksFrom(pageUrl);
}

function getDuplicateCounts() {
    return scanStore.getDuplicateCounts();
}

function invalidateOutgoingLinksCache() {
    scanStore.invalidateOutgoingLinksCache();
}

function invalidateDuplicateCounts() {
    scanStore.invalidateDuplicateCounts();
}

function materializeDiscoveredFromReferrers() {
    return scanStore.materializeDiscoveredFromReferrers();
}

function reinferAllLinkKinds() {
    scanStore.reinferAllLinkKinds();
}

function applyReferrersUpdate(payload) {
    scanStore.applyReferrersUpdate(payload);

    if (uiState === 'running') {
        if (selectedUrl) {
            renderDetailPanel();
        }
        return;
    }
    requestRefreshTable({ immediate: true });
    scheduleWorkspacePersist();
    if (selectedUrl) {
        renderDetailPanel();
    }
}

function getScannableTablePool() {
    const all = Array.from(scanStore.scanResults.values());
    if (uiState === 'running') {
        return all.filter((data) => data.fetched !== false);
    }
    return all;
}

function getTableEntries() {
    const all = getScannableTablePool();
    if (activeContentFilter === 'all') {
        return all;
    }
    return all.filter(matchesResourceTypeFilter);
}

function getRowData(url) {
    return scanStore.scanResults.get(url) || null;
}

function cancelPendingScanRefresh() {
    if (scanRefreshTimer) {
        clearTimeout(scanRefreshTimer);
        scanRefreshTimer = null;
    }
}

function scheduleScanRefresh() {
    if (scanRefreshTimer) {
        return;
    }
    scanRefreshTimer = setTimeout(() => {
        scanRefreshTimer = null;
        invalidateOutgoingLinksCache();
        invalidateDuplicateCounts();
        requestRefreshTable();
    }, SCAN_REFRESH_DELAY_MS);
}

function setActiveContentFilter(value) {
    activeContentFilter = normalizeContentTypeFilter(value);
    if (contentTypeFilter) {
        contentTypeFilter.value = activeContentFilter;
    }
}

function setActiveSourceFilter(value) {
    activeSourceFilter = normalizeSourceFilter(value || 'all');
    if (sourceFilter) {
        sourceFilter.value = activeSourceFilter;
    }
}

function applyActiveFiltersToDom() {
    if (contentTypeFilter && contentTypeFilter.value !== activeContentFilter) {
        contentTypeFilter.value = activeContentFilter;
    }
    if (sourceFilter && sourceFilter.value !== activeSourceFilter) {
        sourceFilter.value = activeSourceFilter;
    }
}

function collectPresentContentTypes() {
    const present = new Set();
    for (const entry of scanStore.scanResults.values()) {
        present.add(getResourceKind(entry));
    }
    return present;
}

function getContentTypeFilterOptions() {
    return RESOURCE_TYPE_FILTER_OPTIONS;
}

function appendContentTypeFilterOption(option) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    contentTypeFilter.appendChild(el);
}

function rebuildContentTypeFilterOptions({ preserveValue = true, force = false } = {}) {
    if (!contentTypeFilter) {
        return;
    }
    if (!force && contentTypeFilter.options.length === RESOURCE_TYPE_FILTER_OPTIONS.length) {
        applyActiveFiltersToDom();
        return;
    }

    const retainedSelection = preserveValue ? activeContentFilter : 'all';

    contentTypeFilter.innerHTML = '';
    for (const option of RESOURCE_TYPE_FILTER_OPTIONS) {
        appendContentTypeFilterOption(option);
    }

    setActiveContentFilter(preserveValue ? retainedSelection : 'all');
}

function maybeUpdateContentTypeFilterOptions() {
    const present = collectPresentContentTypes();
    const presentKey = [...present].sort().join(',');
    if (presentKey === knownPresentContentTypesKey && contentTypeFilter?.options.length > 0) {
        return;
    }
    knownPresentContentTypesKey = presentKey;
    rebuildContentTypeFilterOptions({ preserveValue: true });
}

function getLinkKind(entry) {
    return inferLinkKind(entry);
}

const getOutlinkKind = getLinkKind;
const getOutlinkTag = getLinkTag;

function setScanHostnameFromUrl(startUrl) {
    try {
        scanHostname = new URL(startUrl).hostname;
    } catch {
        scanHostname = '';
    }
    scanStore.setScanHostname(scanHostname);
}

function getScanHostname() {
    if (scanHostname) {
        return scanHostname;
    }
    try {
        return new URL(urlInput.value.trim()).hostname;
    } catch {
        return '';
    }
}

function getFilteredResults() {
    return getTableEntries().filter(passesTableFilters);
}

function getDisplayedResults() {
    const entries = getFilteredResults();
    if (sortState.column) {
        entries.sort(compareRows);
    } else {
        entries.sort((a, b) => scanStore.insertionOrder.indexOf(a.url) - scanStore.insertionOrder.indexOf(b.url));
    }
    return entries;
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

function resetTableFilters() {
    activeStatusFilter = 'all';
    activeIndexingFilter = 'all';
    activeH1Filter = 'all';
    activeDuplicateFilter = 'all';
    activeSearchQuery = '';
    setActiveSourceFilter('all');
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
    rebuildContentTypeFilterOptions({ preserveValue: false });
    updateStatusFilterOptions({ force: true });
}

function urlActionButtons(url) {
    const encoded = encodeURIComponent(url);
    return `<span class="inline-flex items-center gap-0.5 shrink-0 ml-1">
        <button type="button" class="url-copy px-1 py-0.5 text-zinc-400 hover:text-zinc-700 rounded" data-url="${encoded}" title="Копіювати">📋</button>
        <button type="button" class="url-open px-1 py-0.5 text-zinc-400 hover:text-zinc-700 rounded" data-url="${encoded}" title="Відкрити в браузері">↗</button>
    </span>`;
}

function urlCellHtml(url) {
    if (!url) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    return `<span class="flex flex-wrap items-start gap-x-1 gap-y-0.5 min-w-0 w-full">
        <span class="text-blue-700 break-all min-w-0">${escapeHtml(url)}</span>
        ${urlActionButtons(url)}
    </span>`;
}

async function copyUrlToClipboard(url) {
    try {
        await navigator.clipboard.writeText(url);
        statusText.textContent = 'Посилання скопійовано';
    } catch {
        statusText.textContent = 'Не вдалося скопіювати';
    }
}

async function openUrlInBrowser(url) {
    const result = await window.api.openExternal(url);
    if (!result?.ok) {
        statusText.textContent = 'Не вдалося відкрити посилання';
    }
}

function updateExportButton() {
    const canExport = uiState === 'idle' || uiState === 'paused';
    const hasVisibleRows = getFilteredResults().length > 0;
    exportButton.disabled = !hasVisibleRows;
    exportButton.classList.toggle('hidden', !canExport || scanStore.scanResults.size === 0);
}

function updateUrlInputProgress(progress = null) {
    if (!urlInputProgress) {
        return;
    }
    if (progress) {
        lastScanProgress = progress;
    }

    if (uiState === 'idle') {
        urlInputProgress.style.width = '0%';
        if (urlInputWrap) {
            urlInputWrap.classList.remove('url-input-scanning');
        }
        return;
    }

    if (urlInputWrap) {
        urlInputWrap.classList.add('url-input-scanning');
    }

    const snapshot = progress || lastScanProgress || {};
    const scanned = snapshot.scanned ?? 0;
    const queue = snapshot.queue ?? 0;
    const total = scanned + queue;
    const percent = total > 0 ? Math.min(100, Math.max(0, (scanned / total) * 100)) : 0;
    urlInputProgress.style.width = `${percent}%`;
}

function setUIState(state) {
    uiState = state;
    controlsIdle.classList.toggle('hidden', state !== 'idle');
    controlsRunning.classList.toggle('hidden', state !== 'running');
    controlsPaused.classList.toggle('hidden', state !== 'paused');
    urlInput.disabled = state === 'running';
    updateUrlInputProgress();
    if (state === 'idle' || state === 'paused') {
        updateExportButton();
    } else {
        exportButton.classList.add('hidden');
    }
}

function resetTableRenderCache() {
    renderedTableUrlSet = new Set();
    tableDisplayEntries = [];
    tableRenderedCount = 0;
    tableLazyLoadToken += 1;
    invalidateOutgoingLinksCache();
}

function areDefaultTableFiltersActive() {
    return activeContentFilter === 'all'
        && activeSourceFilter === 'all'
        && activeStatusFilter === 'all'
        && activeIndexingFilter === 'all'
        && activeH1Filter === 'all'
        && activeDuplicateFilter === 'all'
        && !activeSearchQuery.trim()
        && !sortState.column;
}

function canIncrementallyRefreshTable() {
    return uiState === 'running' && areDefaultTableFiltersActive();
}

function cancelPendingRefreshTable() {
    if (refreshTableTimer) {
        clearTimeout(refreshTableTimer);
        refreshTableTimer = null;
    }
    cancelPendingScanRefresh();
    tableLazyLoadToken += 1;
}

function scheduleStartupTableRefresh() {
    requestAnimationFrame(() => {
        requestRefreshTable({ immediate: true });
    });
}

function clearScanData() {
    scanStore.clearData();
    resetTableRenderCache();
    selectedUrl = null;
    sortState = { column: null, direction: 'asc' };
    updateSortIndicators();
    resultsTable.innerHTML = '';
    selectedUrlHint.textContent = 'Оберіть рядок у таблиці';
    if (selectedUrlBar) {
        selectedUrlBar.querySelectorAll('.url-copy, .url-open').forEach((el) => el.remove());
    }
    detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть URL у таблиці вище</p>';
}

function clearScanResults() {
    clearScanData();
    resetTableFilters();
    updateExportButton();
    clearWorkspaceSession();
}

function collectWorkspaceSnapshot() {
    return {
        ...buildWorkspaceSnapshot({
            scanResults: scanStore.scanResults,
            insertionOrder: scanStore.insertionOrder,
            startUrl: urlInput.value.trim(),
            lastScanProgress,
            selectedUrl,
            statusHint: statusText.textContent,
            filters: {
                content: activeContentFilter,
                status: activeStatusFilter,
                indexing: activeIndexingFilter,
                h1: activeH1Filter,
                duplicate: activeDuplicateFilter,
                source: activeSourceFilter,
                search: activeSearchQuery,
            },
        }),
    };
}

function persistWorkspaceNow() {
    if (workspacePersistTimer) {
        clearTimeout(workspacePersistTimer);
        workspacePersistTimer = null;
    }
    if (scanStore.scanResults.size === 0) {
        clearWorkspaceSession();
        return;
    }
    saveWorkspaceToSession(collectWorkspaceSnapshot());
}

function scheduleWorkspacePersist() {
    if (uiState === 'running') {
        return;
    }
    if (workspacePersistTimer) {
        return;
    }
    workspacePersistTimer = setTimeout(() => {
        workspacePersistTimer = null;
        persistWorkspaceNow();
    }, WORKSPACE_PERSIST_DELAY_MS);
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
    rebuildContentTypeFilterOptions({ preserveValue: true });
    updateStatusFilterOptions({ force: true });
}

function flattenLegacyOutlinks(entry) {
    const extras = [];
    for (const link of entry.outlinks || []) {
        const normalized = normalizeLegacyLink(link);
        if (normalized) {
            extras.push(normalizeLinkEntry(normalized));
        }
    }
    const { outlinks, linkCount, ...rest } = entry;
    return { entry: normalizeLinkEntry(rest), extras };
}

function populateScanResults(normalized) {
    clearScanData();
    urlInput.value = normalized.startUrl;
    setScanHostnameFromUrl(normalized.startUrl);

    const resultMap = new Map();
    for (const rawEntry of normalized.results) {
        const { entry, extras } = flattenLegacyOutlinks(rawEntry);
        resultMap.set(entry.url, entry);
        for (const extra of extras) {
            if (!resultMap.has(extra.url)) {
                resultMap.set(extra.url, extra);
            }
        }
    }

    const seen = new Set();
    for (const url of normalized.insertionOrder) {
        if (resultMap.has(url) && !seen.has(url)) {
            scanStore.insertionOrder.push(url);
            scanStore.scanResults.set(url, resultMap.get(url));
            seen.add(url);
        }
    }
    for (const [url, entry] of resultMap) {
        if (!seen.has(url)) {
            scanStore.insertionOrder.push(url);
            scanStore.scanResults.set(url, entry);
            seen.add(url);
        }
    }
    scanStore.rebuildLatestReferrersFromResults();
    reinferAllLinkKinds();
    rebuildContentTypeFilterOptions({ preserveValue: true, force: true });
}

function restoreWorkspaceFromSession() {
    const workspace = loadWorkspaceFromSession();
    if (!workspace?.results?.length) {
        return false;
    }

    const normalized = normalizeLoadedDump({
        version: SESSION_DUMP_VERSION,
        startUrl: workspace.startUrl,
        insertionOrder: workspace.insertionOrder,
        results: workspace.results,
        progressAtSave: workspace.lastScanProgress,
    });

    populateScanResults(normalized);
    if (workspace.filters) {
        applyFilterState(workspace.filters);
    }

    lastScanProgress = workspace.lastScanProgress || null;
    scheduleStartupTableRefresh();
    updateUrlInputProgress(lastScanProgress);
    statusScanned.textContent = `Проскановано: ${scanStore.scanResults.size}`;
    statusQueue.textContent = 'У черзі: 0';
    if (statusActive) {
        statusActive.textContent = 'Активних: 0';
    }
    if (statusRate) {
        statusRate.textContent = 'Швидкість: —';
    }
    if (workspace.statusHint) {
        statusText.textContent = workspace.statusHint;
    }

    if (workspace.selectedUrl && scanStore.scanResults.has(workspace.selectedUrl)) {
        selectRow(workspace.selectedUrl);
    }

    updateExportButton();
    return true;
}

async function beginScan(startUrl, { clearResults = true } = {}) {
    if (clearResults) {
        clearScanResults();
    }
    setScanHostnameFromUrl(startUrl);
    lastScanProgress = null;
    setUIState('running');
    updateUrlInputProgress({ scanned: 0, queue: 0 });
    statusText.textContent = `Починаю сканування з ${startUrl}...`;

    const settings = await loadSettings();
    window.api.startSpider(startUrl, {
        useSitemap: settings.useSitemap,
        maxPages: settings.maxPages,
        concurrency: settings.concurrency,
    });
}

function updateSortIndicators() {
    renderTableHead();
}

function applyResultsTdLayout(tdHtml, col) {
    if (!tdHtml.startsWith('<td')) {
        return tdHtml;
    }
    const layoutClass = col.cellNowrap ? 'results-td-compact' : 'results-td-wrap';
    if (tdHtml.includes('class="')) {
        return tdHtml.replace('class="', `class="${layoutClass} `);
    }
    return tdHtml.replace('<td', `<td class="${layoutClass}"`);
}

function renderTableHead() {
    if (!pagesTableHead || !resultsDataTable) {
        return;
    }
    const columns = resolveTableColumns({
        helpers: getPresentationHelpers(),
        sortState,
    });
    renderResultsTableHead(resultsDataTable, pagesTableHead, columns, sortState);
}

function bindTableHeadSort() {
    if (!pagesTableHead || pagesTableHead.dataset.sortBound) {
        return;
    }
    pagesTableHead.addEventListener('click', (event) => {
        if (event.target.closest('.col-resize-handle')) {
            return;
        }
        const th = event.target.closest('.sortable-th');
        if (!th) {
            return;
        }
        const col = th.dataset.sort;
        if (!col) {
            return;
        }
        if (sortState.column === col) {
            sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.column = col;
            sortState.direction = 'asc';
        }
        updateSortIndicators();
        requestRefreshTable({ immediate: true });
    });
    pagesTableHead.dataset.sortBound = '1';
}

function createTableRow(data, displayIndex) {
    const columns = resolveTableColumns({
        helpers: getPresentationHelpers(),
        sortState,
    });
    const tr = document.createElement('tr');
    tr.dataset.url = data.url;
    tr.className = 'border-b border-zinc-100 cursor-pointer hover:bg-zinc-50';
    if (selectedUrl === data.url) {
        tr.classList.add('bg-blue-50');
    }
    tr.innerHTML = columns.map((col) => applyResultsTdLayout(
        col.renderCell(data, { helpers: getPresentationHelpers() }, displayIndex),
        col
    )).join('');
    tr.addEventListener('click', (e) => {
        if (e.target.closest('.url-copy, .url-open')) {
            return;
        }
        selectRow(data.url);
    });
    return tr;
}

function finishTableRefresh(entries, poolSize, { incremental = false } = {}) {
    updateFilterCount(entries.length, poolSize, tableRenderedCount);
    if (uiState === 'idle' || uiState === 'paused') {
        updateExportButton();
    }

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

    for (let i = 0; i < Math.min(tableRenderedCount, entries.length); i++) {
        const data = entries[i];
        const tr = resultsTable.querySelector(`tr[data-url="${CSS.escape(data.url)}"]`);
        if (tr) {
            tr.replaceWith(createTableRow(data, i + 1));
        }
    }

    if (tableRenderedCount < TABLE_VISIBLE_INITIAL) {
        const target = Math.min(TABLE_VISIBLE_INITIAL, entries.length);
        appendTableRows(entries, tableRenderedCount, target);
        tableRenderedCount = target;
    }

    finishTableRefresh(entries, poolSize, { incremental: true });
}

function refreshTable() {
    renderTableHead();
    const incremental = canIncrementallyRefreshTable();
    if (!incremental || scanStore.scanResults.size % STATUS_FILTER_REFRESH_EVERY_N_PAGES === 0) {
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

if (pagesTableScroll) {
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

function syncSelectedRowUi() {
    if (!selectedUrl || !getRowData(selectedUrl)) {
        return;
    }
    selectedUrlHint.textContent = truncate(selectedUrl, 80);
    selectedUrlHint.title = selectedUrl;
    if (selectedUrlBar) {
        selectedUrlBar.querySelectorAll('.url-copy, .url-open').forEach((el) => el.remove());
        const actions = document.createElement('span');
        actions.innerHTML = urlActionButtons(selectedUrl);
        selectedUrlBar.appendChild(actions);
    }
    renderDetailPanel();
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

    const delay = uiState === 'running' ? REFRESH_TABLE_DELAY_MS : 0;
    refreshTableTimer = setTimeout(() => {
        refreshTableTimer = null;
        refreshTable();
    }, delay);
}

function upsertScanResult(incoming, { deferUi = false } = {}) {
    const { isNew, changed } = scanStore.upsertRaw(incoming, { deferUi });
    if (!changed) {
        return false;
    }
    const data = scanStore.scanResults.get(
        (typeof incoming === 'object' && incoming.url) ? incoming.url : incoming
    ) || normalizeLinkEntry(incoming);

    if (uiState === 'running') {
        if (data.fetched !== false) {
            scheduleScanRefresh();
        }
        if (!deferUi && isNew && !selectedUrl) {
            selectedUrl = data.url;
        } else if (!deferUi && selectedUrl === data.url) {
            renderDetailPanel();
        }
        return isNew;
    }

    invalidateOutgoingLinksCache();
    invalidateDuplicateCounts();
    maybeUpdateContentTypeFilterOptions();
    requestRefreshTable();

    if (isNew && !selectedUrl) {
        selectedUrl = data.url;
    } else if (selectedUrl === data.url) {
        renderDetailPanel();
    }
    return isNew;
}

function upsertScanResultsBatch(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return;
    }

    let changed = false;
    for (const incoming of items) {
        if (upsertScanResult(incoming, { deferUi: true })) {
            changed = true;
        }
    }

    if (!changed) {
        return;
    }

    invalidateOutgoingLinksCache();
    invalidateDuplicateCounts();

    if (uiState === 'running') {
        return;
    }

    maybeUpdateContentTypeFilterOptions();
    requestRefreshTable();
}

function setActiveTab(tab) {
    activeTab = tab;
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
    if (linkTableSortState.column === col) {
        linkTableSortState.direction = linkTableSortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        linkTableSortState.column = col;
        linkTableSortState.direction = 'asc';
    }
    renderDetailPanel();
});

if (contentTypeFilter) {
    contentTypeFilter.addEventListener('change', () => {
        setActiveContentFilter(contentTypeFilter.value);
        requestRefreshTable({ immediate: true });
        scheduleWorkspacePersist();
    });
}

if (statusFilter) {
    statusFilter.addEventListener('change', () => {
        activeStatusFilter = statusFilter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (indexingFilter) {
    indexingFilter.addEventListener('change', () => {
        activeIndexingFilter = indexingFilter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (h1Filter) {
    h1Filter.addEventListener('change', () => {
        activeH1Filter = h1Filter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (duplicateFilter) {
    duplicateFilter.addEventListener('change', () => {
        activeDuplicateFilter = duplicateFilter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (sourceFilter) {
    sourceFilter.addEventListener('change', () => {
        setActiveSourceFilter(sourceFilter.value);
        requestRefreshTable({ immediate: true });
        scheduleWorkspacePersist();
    });
}

function scheduleSearchRefresh() {
    if (searchRefreshTimer) {
        return;
    }
    searchRefreshTimer = setTimeout(() => {
        searchRefreshTimer = null;
        requestRefreshTable({ immediate: true });
        scheduleWorkspacePersist();
    }, SEARCH_REFRESH_DELAY_MS);
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
            requestRefreshTable({ immediate: true });
            scheduleWorkspacePersist();
        }
    });
}

function selectRow(url) {
    selectedUrl = url;
    document.querySelectorAll('#resultsTable tr').forEach((tr) => {
        tr.classList.toggle('bg-blue-50', tr.dataset.url === url);
    });
    syncSelectedRowUi();
    scheduleWorkspacePersist();
}

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
    return [...links].sort(compareLinkRows);
}

function renderLinkTable(links, emptyText, caption = '') {
    if (!links || links.length === 0) {
        return `<p class="p-4 text-zinc-400 italic">${escapeHtml(emptyText)}</p>`;
    }
    const captionHtml = caption
        ? `<p class="px-4 py-2 text-xs text-zinc-500 border-b border-zinc-100 bg-zinc-50">${escapeHtml(caption)}</p>`
        : '';
    const rows = sortLinkRows(links)
        .map(
            (link) => {
                const external = isExternalOutlink(link);
                const typeBadge = external
                    ? '<span class="inline-block ml-1 px-1 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 whitespace-nowrap" title="Зовнішнє посилання — не обходиться">зовн.</span>'
                    : '';
                const tag = getOutlinkTag(link);
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

function getFilteredOutgoingLinks(pageUrl) {
    let links = getOutgoingLinksFrom(pageUrl);
    if (activeSourceFilter === 'external') {
        links = links.filter((link) => isExternalLink(link));
    } else if (activeSourceFilter === 'internal') {
        links = links.filter((link) => !isExternalLink(link));
    }
    if (activeContentFilter !== 'all') {
        links = links.filter(matchesResourceTypeFilter);
    }
    return links;
}

function renderDetailPanel() {
    const data = selectedUrl ? getRowData(selectedUrl) : null;
    if (!selectedUrl || !data) {
        detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть URL у таблиці вище</p>';
        return;
    }

    if (activeTab === 'details') {
        const rows = resolveDetailRows({ data, helpers: getPresentationHelpers() });
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
        const caption = activeSourceFilter !== 'all' || activeContentFilter !== 'all'
            ? `Показано: ${outgoing.length} з ${allOutgoing.length}`
            : (allOutgoing.length ? `Всього: ${allOutgoing.length}` : '');
        detailContent.innerHTML = renderLinkTable(
            outgoing,
            'Немає вихідних посилань за поточними фільтрами',
            caption
        );
    }
}

exportButton.addEventListener('click', () => {
    const entries = getDisplayedResults();
    if (entries.length === 0) {
        alert('Немає рядків для експорту за поточними фільтрами.');
        return;
    }
    exportFilteredResultsToCsv(entries, { helpers: getPresentationHelpers() });
});

document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.url-copy');
    const openBtn = e.target.closest('.url-open');
    if (copyBtn) {
        e.stopPropagation();
        copyUrlToClipboard(decodeUrlAttr(copyBtn.dataset.url));
        return;
    }
    if (openBtn) {
        e.stopPropagation();
        openUrlInBrowser(decodeUrlAttr(openBtn.dataset.url));
    }
});

async function ensureCanReplaceSession(actionLabel) {
    if (uiState === 'idle') {
        return true;
    }
    const message = uiState === 'paused'
        ? `${actionLabel} зупинить паузу та замінить поточні результати. Продовжити?`
        : `${actionLabel} зупинить активне сканування та замінить поточні результати. Продовжити?`;
    if (!confirm(message)) {
        return false;
    }
    if (uiState === 'running' || uiState === 'paused') {
        window.api.stopSpider();
    }
    setUIState('idle');
    lastScanProgress = null;
    updateUrlInputProgress();
    return true;
}

async function saveSessionDumpToFile() {
    if (scanStore.scanResults.size === 0) {
        alert('Немає результатів для збереження.');
        return;
    }
    const payload = buildSessionDumpPayload({
        scanResults: scanStore.scanResults,
        insertionOrder: scanStore.insertionOrder,
        startUrl: urlInput.value.trim(),
        uiState,
        lastScanProgress,
    });
    const result = await window.api.saveSessionDump(payload);
    if (result?.canceled) {
        return;
    }
    if (!result?.ok) {
        alert(result?.error || 'Не вдалося зберегти дамп.');
        return;
    }
    statusText.textContent = `Дамп збережено: ${result.filePath}`;
}

function applySessionDump(dump, filePath = '') {
    const normalized = normalizeLoadedDump({ ...dump, filePath });
    resetTableFilters();
    populateScanResults(normalized);

    selectedUrl = null;
    lastScanProgress = normalized.progressAtSave;
    requestRefreshTable({ immediate: true });
    setUIState('idle');
    updateUrlInputProgress(normalized.progressAtSave);
    statusScanned.textContent = `Проскановано: ${scanStore.scanResults.size}`;
    statusQueue.textContent = 'У черзі: 0';
    if (statusActive) {
        statusActive.textContent = 'Активних: 0';
    }
    if (statusRate) {
        statusRate.textContent = 'Швидкість: —';
    }
    statusText.textContent = filePath
        ? `Завантажено дамп (${scanStore.scanResults.size} URL): ${filePath}`
        : `Завантажено дамп: ${scanStore.scanResults.size} URL`;
    persistWorkspaceNow();
}

async function loadSessionDumpFromFile() {
    const canContinue = await ensureCanReplaceSession('Завантаження дампу');
    if (!canContinue) {
        return;
    }
    const result = await window.api.loadSessionDump();
    if (result?.canceled) {
        return;
    }
    if (!result?.ok) {
        alert(result?.error || 'Не вдалося завантажити дамп.');
        return;
    }
    applySessionDump(result.dump, result.filePath || '');
}

async function handleMenuLoadedDump(payload) {
    if (!payload?.ok || !payload.dump) {
        return;
    }
    const canContinue = await ensureCanReplaceSession('Завантаження дампу');
    if (!canContinue) {
        return;
    }
    applySessionDump(payload.dump, payload.filePath || '');
}

window.api.onSessionDumpRequestSave(() => saveSessionDumpToFile());
window.api.onSessionDumpLoaded((payload) => handleMenuLoadedDump(payload));

startButton.addEventListener('click', async () => {
    const startUrl = urlInput.value.trim();
    try {
        new URL(startUrl);
        await beginScan(startUrl);
    } catch {
        alert('Будь ласка, введіть коректний URL (наприклад, https://example.com).');
    }
});

stopButton.addEventListener('click', async () => {
    if (uiState !== 'running') {
        return;
    }
    setUIState('paused');
    statusText.textContent = 'На паузі';
    cancelPendingRefreshTable();
    requestRefreshTable({ immediate: true });
    persistWorkspaceNow();
    await window.api.pauseSpider();
});

resumeButton.addEventListener('click', async () => {
    if (uiState !== 'paused') {
        return;
    }
    await window.api.resumeSpider();
    setUIState('running');
});

restartButton.addEventListener('click', async () => {
    const startUrl = urlInput.value.trim();
    try {
        new URL(startUrl);
        await beginScan(startUrl);
    } catch {
        alert('Будь ласка, введіть коректний URL (наприклад, https://example.com).');
    }
});

window.api.onSpiderResult((data) => {
    upsertScanResult(data);
});

window.api.onSpiderResultsBatch((items) => {
    upsertScanResultsBatch(items);
});

window.api.onSpiderReferrersUpdate((allReferrers) => {
    applyReferrersUpdate(allReferrers);
});

function finalizeScanUi(message) {
    cancelPendingRefreshTable();
    if (workspacePersistTimer) {
        clearTimeout(workspacePersistTimer);
        workspacePersistTimer = null;
    }
    lastScanProgress = {
        ...(lastScanProgress || {}),
        scanned: lastScanProgress?.scanned ?? scanStore.scanResults.size,
        queue: 0,
        active: 0,
        finished: true,
        status: message,
    };
    statusText.textContent = message;
    const fetchedCount = Array.from(scanStore.scanResults.values()).filter((row) => row.fetched !== false).length;
    statusScanned.textContent = `Проскановано: ${fetchedCount}`;
    statusQueue.textContent = 'У черзі: 0';
    if (statusActive) {
        statusActive.textContent = 'Активних: 0';
    }
    if (statusRate) {
        statusRate.textContent = 'Швидкість: —';
    }
    if (urlInputProgress) {
        urlInputProgress.style.width = '100%';
    }
    if (urlInputWrap) {
        urlInputWrap.classList.remove('url-input-scanning');
    }
    if (uiState !== 'idle') {
        setUIState('idle');
    }
    requestAnimationFrame(() => {
        materializeDiscoveredFromReferrers();
        reinferAllLinkKinds();
        invalidateOutgoingLinksCache();
        invalidateDuplicateCounts();
        maybeUpdateContentTypeFilterOptions();
        refreshTable();
        persistWorkspaceNow();
    });
}

window.api.onSpiderEnd((message) => {
    finalizeScanUi(message);
});

window.api.onSpiderProgress((progress) => {
    if (progress.finished) {
        return;
    }
    // Лише синхронізуємо паузу з бекенду; не відновлюємо running автоматично —
    // інакше завершення воркерів до обробки pause IPC повертає кнопку «Зупинити».
    if (progress.paused && uiState === 'running') {
        setUIState('paused');
    }
    updateUrlInputProgress(progress);
    if (uiState === 'paused') {
        statusText.textContent = 'На паузі';
    } else {
        statusText.textContent = progress.status || 'В процесі...';
    }
    statusScanned.textContent = `Проскановано: ${progress.scanned}`;
    const queueHtml = progress.queueHtml ?? 0;
    const queueMedia = progress.queueMedia ?? 0;
    if (queueHtml > 0 || queueMedia > 0) {
        statusQueue.textContent = `У черзі: ${progress.queue} (HTML: ${queueHtml}, медіа: ${queueMedia})`;
    } else {
        statusQueue.textContent = `У черзі: ${progress.queue ?? 0}`;
    }
    if (statusActive) {
        const active = progress.active ?? 0;
        const concurrency = progress.concurrency ?? 0;
        statusActive.textContent = concurrency > 0
            ? `Активних: ${active}/${concurrency}`
            : `Активних: ${active}`;
    }
    if (statusRate) {
        if (uiState === 'running' && !progress.paused && (progress.pagesPerSecond ?? 0) > 0) {
            statusRate.textContent = `Швидкість: ${progress.pagesPerSecond} стор./с`;
        } else if (uiState === 'paused') {
            statusRate.textContent = 'Швидкість: —';
        } else if (uiState === 'idle' && (progress.pagesPerSecond ?? 0) > 0) {
            statusRate.textContent = `Швидкість: ${progress.pagesPerSecond} стор./с`;
        } else {
            statusRate.textContent = 'Швидкість: —';
        }
    }
});

const DETAIL_PANEL_HEIGHT_KEY = 'detailPanelHeight';
const DEFAULT_DETAIL_PANEL_HEIGHT = 256;
const MIN_DETAIL_PANEL_HEIGHT = 120;
const MIN_RESULTS_PANEL_HEIGHT = 120;

function initDetailPanelResize() {
    const mainEl = document.querySelector('main');
    const handle = document.getElementById('panelResizeHandle');
    const panel = document.getElementById('detailPanel');
    if (!mainEl || !handle || !panel) {
        return;
    }

    function clampPanelHeight(height) {
        const mainHeight = mainEl.getBoundingClientRect().height;
        const maxHeight = Math.max(
            MIN_DETAIL_PANEL_HEIGHT,
            mainHeight - MIN_RESULTS_PANEL_HEIGHT - handle.offsetHeight - 12
        );
        return Math.min(maxHeight, Math.max(MIN_DETAIL_PANEL_HEIGHT, height));
    }

    function setPanelHeight(height) {
        panel.style.height = `${clampPanelHeight(height)}px`;
    }

    const savedHeight = parseInt(localStorage.getItem(DETAIL_PANEL_HEIGHT_KEY), 10);
    setPanelHeight(Number.isFinite(savedHeight) ? savedHeight : DEFAULT_DETAIL_PANEL_HEIGHT);

    handle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = panel.getBoundingClientRect().height;

        function onMouseMove(moveEvent) {
            setPanelHeight(startHeight + (startY - moveEvent.clientY));
        }

        function onMouseUp() {
            document.body.classList.remove('panel-resizing');
            localStorage.setItem(
                DETAIL_PANEL_HEIGHT_KEY,
                String(Math.round(panel.getBoundingClientRect().height))
            );
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.body.classList.add('panel-resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    handle.addEventListener('dblclick', () => {
        setPanelHeight(DEFAULT_DETAIL_PANEL_HEIGHT);
        localStorage.removeItem(DETAIL_PANEL_HEIGHT_KEY);
    });

    let resizeRaf = null;
    window.addEventListener('resize', () => {
        if (resizeRaf) {
            cancelAnimationFrame(resizeRaf);
        }
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = null;
            setPanelHeight(panel.getBoundingClientRect().height);
        });
    });
}

function runStartup() {
    initDetailPanelResize();
    setUIState('idle');
    renderTableHead();
    bindTableHeadSort();
    bindResultsTableColumnResize(resultsDataTable, pagesTableHead, () => {
        renderTableHead();
    });

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const restored = restoreWorkspaceFromSession();
            if (!restored) {
                rebuildContentTypeFilterOptions({ force: true });
            }
        });
    });
}

runStartup();

window.addEventListener('pagehide', () => {
    persistWorkspaceNow();
});
