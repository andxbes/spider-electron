/**
 * Workspace persistence: sessionStorage snapshot, restore, populate results.
 */
(function initWorkspaceController(root) {
const WORKSPACE_PERSIST_DELAY_MS = 200;

function createWorkspaceController(deps) {
    const {
        scanStore,
        tableFilters,
        tableView,
        elements,
        getLastScanProgress,
        setLastScanProgress,
        getSelectedUrl,
        setSelectedUrl,
        getSortState,
        setSortState,
        getUiState,
        normalizeLinkEntry,
        reinferAllLinkKinds,
        clearScanData,
        updateExportButton,
        updateUrlInputProgress,
        scheduleStartupTableRefresh,
        selectRow,
        requestRefreshTable,
        setScanHostnameFromUrl,
    } = deps;

    const {
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
    } = elements;

    let workspacePersistTimer = null;

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

    function collectWorkspaceSnapshot() {
        return {
            ...buildWorkspaceSnapshot({
                scanResults: scanStore.scanResults,
                insertionOrder: scanStore.insertionOrder,
                startUrl: urlInput.value.trim(),
                lastScanProgress: getLastScanProgress(),
                selectedUrl: getSelectedUrl(),
                statusHint: statusText.textContent,
                filters: tableFilters.getFilterSnapshot(),
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
        if (getUiState() === 'running') {
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

    function cancelWorkspacePersistTimer() {
        if (workspacePersistTimer) {
            clearTimeout(workspacePersistTimer);
            workspacePersistTimer = null;
        }
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
        tableFilters.rebuildContentTypeFilterOptions({ preserveValue: true, force: true });
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
            tableFilters.applyFilterState(workspace.filters);
        }

        setLastScanProgress(workspace.lastScanProgress || null);
        scheduleStartupTableRefresh();
        updateUrlInputProgress(workspace.lastScanProgress);
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

    function applySessionDump(dump, filePath = '') {
        const normalized = normalizeLoadedDump({ ...dump, filePath });
        tableFilters.resetTableFilters();
        populateScanResults(normalized);

        setSelectedUrl(null);
        setLastScanProgress(normalized.progressAtSave);
        requestRefreshTable({ immediate: true });
        deps.setUIState('idle');
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

    function clearScanResults() {
        clearScanData();
        tableFilters.resetTableFilters();
        updateExportButton();
        clearWorkspaceSession();
    }

    return {
        persistWorkspaceNow,
        scheduleWorkspacePersist,
        cancelWorkspacePersistTimer,
        populateScanResults,
        restoreWorkspaceFromSession,
        applySessionDump,
        clearScanResults,
        collectWorkspaceSnapshot,
    };
}

const exported = { createWorkspaceController };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
