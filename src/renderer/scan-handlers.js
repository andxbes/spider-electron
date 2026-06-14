/**
 * IPC scan handlers: upsert results, finalize scan, progress updates.
 */
(function initScanHandlers(root) {
const SCAN_REFRESH_DELAY_MS = 400;

function createScanHandlers(deps) {
    const {
        scanStore,
        tableFilters,
        normalizeLinkEntry,
        getUiState,
        setUiState,
        getSelectedUrl,
        setSelectedUrl,
        getLastScanProgress,
        setLastScanProgress,
        invalidateOutgoingLinksCache,
        invalidateDuplicateCounts,
        materializeDiscoveredFromReferrers,
        reinferAllLinkKinds,
        requestRefreshTable,
        cancelPendingRefreshTable,
        refreshTable,
        renderDetailPanel,
        persistWorkspaceNow,
        cancelWorkspacePersistTimer,
        elements,
    } = deps;

    const {
        statusText,
        statusScanned,
        statusQueue,
        statusActive,
        statusRate,
        urlInputProgress,
        urlInputWrap,
    } = elements;

    let scanRefreshTimer = null;

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

    function applyReferrersUpdate(payload) {
        scanStore.applyReferrersUpdate(payload);

        if (getUiState() === 'running') {
            if (getSelectedUrl()) {
                renderDetailPanel();
            }
            return;
        }
        requestRefreshTable({ immediate: true });
        deps.scheduleWorkspacePersist();
        if (getSelectedUrl()) {
            renderDetailPanel();
        }
    }

    function upsertScanResult(incoming, { deferUi = false } = {}) {
        const { isNew, changed } = scanStore.upsertRaw(incoming, { deferUi });
        if (!changed) {
            return false;
        }
        const data = scanStore.scanResults.get(
            (typeof incoming === 'object' && incoming.url) ? incoming.url : incoming
        ) || normalizeLinkEntry(incoming);

        if (getUiState() === 'running') {
            if (data.fetched !== false) {
                scheduleScanRefresh();
            }
            if (!deferUi && isNew && !getSelectedUrl()) {
                setSelectedUrl(data.url);
            } else if (!deferUi && getSelectedUrl() === data.url) {
                renderDetailPanel();
            }
            return isNew;
        }

        invalidateOutgoingLinksCache();
        invalidateDuplicateCounts();
        tableFilters.maybeUpdateContentTypeFilterOptions();
        requestRefreshTable();

        if (isNew && !getSelectedUrl()) {
            setSelectedUrl(data.url);
        } else if (getSelectedUrl() === data.url) {
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

        if (getUiState() === 'running') {
            return;
        }

        tableFilters.maybeUpdateContentTypeFilterOptions();
        requestRefreshTable();
    }

    function finalizeScanUi(message) {
        cancelPendingRefreshTable();
        cancelWorkspacePersistTimer();
        setLastScanProgress({
            ...(getLastScanProgress() || {}),
            scanned: getLastScanProgress()?.scanned ?? scanStore.scanResults.size,
            queue: 0,
            active: 0,
            finished: true,
            status: message,
        });
        statusText.textContent = message;
        const fetchedCount = Array.from(scanStore.scanResults.values())
            .filter((row) => row.fetched !== false).length;
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
        if (getUiState() !== 'idle') {
            setUiState('idle');
        }
        requestAnimationFrame(() => {
            materializeDiscoveredFromReferrers();
            reinferAllLinkKinds();
            invalidateOutgoingLinksCache();
            invalidateDuplicateCounts();
            tableFilters.maybeUpdateContentTypeFilterOptions();
            refreshTable();
            persistWorkspaceNow();
        });
    }

    function handleSpiderProgress(progress) {
        if (progress.finished) {
            return;
        }
        if (progress.paused && getUiState() === 'running') {
            setUiState('paused');
        }
        deps.updateUrlInputProgress(progress);
        if (getUiState() === 'paused') {
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
            if (getUiState() === 'running' && !progress.paused && (progress.pagesPerSecond ?? 0) > 0) {
                statusRate.textContent = `Швидкість: ${progress.pagesPerSecond} стор./с`;
            } else if (getUiState() === 'paused') {
                statusRate.textContent = 'Швидкість: —';
            } else if (getUiState() === 'idle' && (progress.pagesPerSecond ?? 0) > 0) {
                statusRate.textContent = `Швидкість: ${progress.pagesPerSecond} стор./с`;
            } else {
                statusRate.textContent = 'Швидкість: —';
            }
        }
    }

    function bindSpiderIpc() {
        window.api.onSpiderResult((data) => {
            upsertScanResult(data);
        });

        window.api.onSpiderResultsBatch((items) => {
            upsertScanResultsBatch(items);
        });

        window.api.onSpiderReferrersUpdate((allReferrers) => {
            applyReferrersUpdate(allReferrers);
        });

        window.api.onSpiderEnd((message) => {
            finalizeScanUi(message);
        });

        window.api.onSpiderProgress((progress) => {
            handleSpiderProgress(progress);
        });
    }

    return {
        upsertScanResult,
        upsertScanResultsBatch,
        applyReferrersUpdate,
        finalizeScanUi,
        handleSpiderProgress,
        scheduleScanRefresh,
        cancelPendingScanRefresh,
        bindSpiderIpc,
    };
}

const exported = { createScanHandlers };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
