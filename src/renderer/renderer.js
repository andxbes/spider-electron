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

let tableView;
let detailPanel;

let selectedUrl = null;
let activeTab = 'details';
let sortState = { column: null, direction: 'asc' };
let linkTableSortState = { column: 'url', direction: 'asc' };
/** @type {'idle' | 'running' | 'paused'} */
let uiState = 'idle';
let lastScanProgress = null;
let workspace;
let scanHandlers;

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

function isExternalUrl(url) {
    return isExternalUrlImpl(url, getScanHostname());
}

function isExternalLink(entry) {
    return isExternalLinkImpl(entry, getScanHostname());
}

function normalizeLinkEntry(data) {
    return normalizeLinkEntryImpl(data, getScanHostname());
}

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

function getRowMetrics(data) {
    return getRowMetricsImpl(data, {
        getReferrersForUrl,
        getOutgoingLinksFrom,
        isDiscoveredOnly,
        isExternalLink: (entry) => isExternalLinkImpl(entry, getScanHostname()),
        scanHostname: getScanHostname(),
    });
}

function getRowData(url) {
    return scanStore.scanResults.get(url) || null;
}

function setScanHostnameFromUrl(startUrl) {
    try {
        scanHostname = new URL(startUrl).hostname;
        scanStore.setScanHostname(scanHostname);
    } catch {
        scanHostname = '';
        scanStore.setScanHostname('');
    }
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

function requestRefreshTable(options) {
    tableView.requestRefreshTable(options);
}

function cancelPendingRefreshTable() {
    tableView.cancelPendingRefreshTable();
}

function refreshTable() {
    tableView.refreshTable();
}

function renderDetailPanel() {
    detailPanel.renderDetailPanel();
}

function setActiveTab(tab) {
    detailPanel.setActiveTab(tab);
}

function scheduleWorkspacePersist() {
    workspace?.scheduleWorkspacePersist();
}

function persistWorkspaceNow() {
    workspace?.persistWorkspaceNow();
}

function cancelPendingScanRefresh() {
    scanHandlers?.cancelPendingScanRefresh();
}

const tableFilters = createTableFilters({
    scanStore,
    getUiState: () => uiState,
    getScanHostname,
    getSortState: () => sortState,
    setSortState: (next) => { sortState = next; },
    elements: {
        contentTypeFilter,
        statusFilter,
        indexingFilter,
        h1Filter,
        duplicateFilter,
        sourceFilter,
        tableSearch,
    },
    onFilterChange: requestRefreshTable,
    onPersistWorkspace: scheduleWorkspacePersist,
    isExternalLink,
    compareRowsImpl,
    invalidateDuplicateCounts,
    onTableHeadRefresh: () => tableView.renderTableHead(),
});

tableView = createTableView({
    resultsTable,
    resultsDataTable,
    pagesTableHead,
    pagesTableScroll,
    filterCount,
    detailContent,
    getDisplayedResults: () => tableFilters.getDisplayedResults(),
    getTableEntries: () => tableFilters.getTableEntries(),
    getRowData,
    getUiState: () => uiState,
    areDefaultTableFiltersActive: () => tableFilters.areDefaultTableFiltersActive(),
    updateStatusFilterOptions: (opts) => tableFilters.updateStatusFilterOptions(opts),
    updateExportButton,
    syncSelectedRowUi,
    getSelectedUrl: () => selectedUrl,
    onSelectRow: selectRow,
    onCancelPendingScanRefresh: cancelPendingScanRefresh,
    getTableHelpers: getPresentationHelpers,
    getSortState: () => sortState,
    getScanResultsSize: () => scanStore.scanResults.size,
    onTableSortChange: (col) => tableFilters.onTableSortChange(col),
});

detailPanel = createDetailPanel({
    detailContent,
    getSelectedUrl: () => selectedUrl,
    getRowData,
    getActiveTab: () => activeTab,
    setActiveTab: (tab) => { activeTab = tab; },
    getReferrersForUrl,
    getOutgoingLinksFrom,
    getFilteredOutgoingLinks: (pageUrl) => tableFilters.getFilteredOutgoingLinks(pageUrl, getOutgoingLinksFrom),
    urlCellHtml,
    getLinkTableSortState: () => linkTableSortState,
    setLinkTableSortState: (next) => { linkTableSortState = next; },
    getDetailHelpers: getPresentationHelpers,
    hasActiveLinkFilters: () => tableFilters.hasActiveLinkFilters(),
});

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

function selectRow(url) {
    selectedUrl = url;
    document.querySelectorAll('#resultsTable tr').forEach((tr) => {
        tr.classList.toggle('bg-blue-50', tr.dataset.url === url);
    });
    syncSelectedRowUi();
    scheduleWorkspacePersist();
}

workspace = createWorkspaceController({
    scanStore,
    tableFilters,
    tableView,
    elements: {
        urlInput,
        statusText,
        statusScanned,
        statusQueue,
        statusActive,
        statusRate,
        selectedUrlHint,
        selectedUrlBar,
        detailContent,
        resultsTable,
    },
    getLastScanProgress: () => lastScanProgress,
    setLastScanProgress: (v) => { lastScanProgress = v; },
    getSelectedUrl: () => selectedUrl,
    setSelectedUrl: (url) => { selectedUrl = url; },
    getSortState: () => sortState,
    setSortState: (next) => { sortState = next; },
    getUiState: () => uiState,
    normalizeLinkEntry,
    reinferAllLinkKinds,
    clearScanData,
    updateExportButton,
    updateUrlInputProgress,
    scheduleStartupTableRefresh,
    selectRow,
    requestRefreshTable,
    setScanHostnameFromUrl,
    setUIState,
});

scanHandlers = createScanHandlers({
    scanStore,
    tableFilters,
    normalizeLinkEntry,
    getUiState: () => uiState,
    setUiState: setUIState,
    getSelectedUrl: () => selectedUrl,
    setSelectedUrl: (url) => { selectedUrl = url; },
    getLastScanProgress: () => lastScanProgress,
    setLastScanProgress: (v) => { lastScanProgress = v; },
    invalidateOutgoingLinksCache,
    invalidateDuplicateCounts,
    materializeDiscoveredFromReferrers,
    reinferAllLinkKinds,
    requestRefreshTable,
    cancelPendingRefreshTable,
    refreshTable,
    renderDetailPanel,
    persistWorkspaceNow,
    cancelWorkspacePersistTimer: () => workspace.cancelWorkspacePersistTimer(),
    scheduleWorkspacePersist,
    updateUrlInputProgress,
    elements: {
        statusText,
        statusScanned,
        statusQueue,
        statusActive,
        statusRate,
        urlInputProgress,
        urlInputWrap,
    },
});

scanHandlers.bindSpiderIpc();

function updateExportButton() {
    const canExport = uiState === 'idle' || uiState === 'paused';
    const hasVisibleRows = tableFilters.getFilteredResults().length > 0;
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

function scheduleStartupTableRefresh() {
    requestAnimationFrame(() => {
        requestRefreshTable({ immediate: true });
    });
}

function clearScanData() {
    scanStore.clearData();
    tableView.resetTableRenderCache();
    selectedUrl = null;
    sortState = { column: null, direction: 'asc' };
    tableView.renderTableHead();
    resultsTable.innerHTML = '';
    selectedUrlHint.textContent = 'Оберіть рядок у таблиці';
    if (selectedUrlBar) {
        selectedUrlBar.querySelectorAll('.url-copy, .url-open').forEach((el) => el.remove());
    }
    detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть URL у таблиці вище</p>';
}

async function beginScan(startUrl, { clearResults = true } = {}) {
    if (clearResults) {
        workspace.clearScanResults();
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

exportButton.addEventListener('click', () => {
    const entries = tableFilters.getDisplayedResults();
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
    workspace.applySessionDump(result.dump, result.filePath || '');
}

async function handleMenuLoadedDump(payload) {
    if (!payload?.ok || !payload.dump) {
        return;
    }
    const canContinue = await ensureCanReplaceSession('Завантаження дампу');
    if (!canContinue) {
        return;
    }
    workspace.applySessionDump(payload.dump, payload.filePath || '');
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
    tableView.bindTableChrome();
    tableView.renderTableHead();
    tableFilters.bindFilterControls();
    detailPanel.bindTabs();

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const restored = workspace.restoreWorkspaceFromSession();
            if (!restored) {
                tableFilters.rebuildContentTypeFilterOptions({ force: true });
            }
        });
    });
}

runStartup();

window.addEventListener('pagehide', () => {
    persistWorkspaceNow();
});
