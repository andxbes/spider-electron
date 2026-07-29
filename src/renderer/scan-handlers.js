/**
 * IPC scan handlers: upsert results, finalize scan, progress updates.
 */
(function initScanHandlers(root) {
const SCAN_REFRESH_DELAY_MS_SMALL = 400;
const SCAN_REFRESH_DELAY_MS_LARGE = 2000;
const LARGE_SCAN_REFRESH_THRESHOLD = 5000;

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
        const isLarge = scanStore.scanResults.size >= LARGE_SCAN_REFRESH_THRESHOLD;
        const delay = isLarge ? SCAN_REFRESH_DELAY_MS_LARGE : SCAN_REFRESH_DELAY_MS_SMALL;
        scanRefreshTimer = setTimeout(() => {
            scanRefreshTimer = null;
            invalidateOutgoingLinksCache();
            invalidateDuplicateCounts();
            deps.invalidateDisplayedResultsCache?.();
            requestRefreshTable();
        }, delay);
    }

    function applyReferrersUpdate(payload) {
        if (payload?.skipFullSync) {
            scanStore.rebuildLatestReferrersFromResults();
            scanStore.materializeDiscoveredFromReferrers();
            scanStore.invalidateOutgoingLinksCache();
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
            return;
        }

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
        deps.invalidateDisplayedResultsCache?.();
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
        let hasFetched = false;
        for (const incoming of items) {
            if (incoming?.fetched !== false) {
                hasFetched = true;
            }
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
            if (hasFetched) {
                scheduleScanRefresh();
            }
            return;
        }

        requestRefreshTable();
    }

    function finalizeScanUi(message) {
        cancelPendingRefreshTable();
        cancelPendingScanRefresh();
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
        statusScanned.textContent = `Проскановано: ${scanStore.scanResults.size}`;
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

        const resultCount = scanStore.scanResults.size;
        const LARGE_SCAN_UI_THRESHOLD = 5000;
        const WORKSPACE_PERSIST_MAX = 2500;

        /** Yield to the event loop so the browser can repaint between steps. */
        function yieldThen(fn) {
            return new Promise((resolve) => {
                setTimeout(() => { fn(); resolve(); }, 0);
            });
        }

        async function finalizeScanSteps() {
            await yieldThen(() => {
                materializeDiscoveredFromReferrers();
            });

            if (resultCount <= LARGE_SCAN_UI_THRESHOLD) {
                await yieldThen(() => {
                    reinferAllLinkKinds();
                });
            }

            await yieldThen(() => {
                invalidateOutgoingLinksCache();
                invalidateDuplicateCounts();
                deps.invalidateDisplayedResultsCache?.();
            });

            await yieldThen(() => {
                refreshTable();
            });

            if (resultCount <= WORKSPACE_PERSIST_MAX) {
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(() => persistWorkspaceNow(), { timeout: 5000 });
                } else {
                    setTimeout(() => persistWorkspaceNow(), 0);
                }
            }
        }

        requestAnimationFrame(() => {
            finalizeScanSteps();
        });
    }

    function handleSpiderProgress(progress) {
        if (getLastScanProgress()?.finished && !progress.finished) {
            return;
        }
        if (progress.finished) {
            setLastScanProgress({
                ...(getLastScanProgress() || {}),
                ...progress,
                queue: 0,
                active: 0,
                finished: true,
            });
            statusText.textContent = progress.status || 'Сканування завершено!';
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
