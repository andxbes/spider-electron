const SESSION_DUMP_VERSION = 1;
const WORKSPACE_STORAGE_KEY = 'spider-electron.workspace.v1';
const WORKSPACE_SELECTED_URL_KEY = 'spider-electron.workspace.selectedUrl.v1';
const WORKSPACE_VERSION = 1;

function cloneResultEntry(data) {
    return {
        url: data.url,
        status: data.status,
        title: data.title ?? '',
        metaDescription: data.metaDescription ?? '',
        metaCanonical: data.metaCanonical ?? '',
        contentType: data.contentType ?? '',
        metaRobots: data.metaRobots ?? '',
        metaRobotsStatus: data.metaRobotsStatus ?? 'none',
        metaRobotsLabel: data.metaRobotsLabel ?? '',
        xRobotsTag: data.xRobotsTag ?? '',
        xRobotsTagStatus: data.xRobotsTagStatus ?? 'none',
        xRobotsTagLabel: data.xRobotsTagLabel ?? '',
        responseHeaders: Array.isArray(data.responseHeaders)
            ? data.responseHeaders.map((header) => ({ ...header }))
            : [],
        robotsAllowed: data.robotsAllowed ?? null,
        robotsRule: data.robotsRule ?? '',
        responseTimeMs: data.responseTimeMs ?? null,
        redirectUrl: data.redirectUrl ?? '',
        redirectHopCount: data.redirectHopCount ?? 0,
        redirectFinalUrl: data.redirectFinalUrl ?? '',
        redirectInfinite: Boolean(data.redirectInfinite),
        redirectChain: Array.isArray(data.redirectChain) ? [...data.redirectChain] : [],
        redirectLoopStartUrl: data.redirectLoopStartUrl ?? '',
        redirectHopOnly: Boolean(data.redirectHopOnly),
        external: Boolean(data.external),
        fetched: data.fetched ?? (data.status !== '' && data.status !== undefined && data.status !== null),
        kind: data.kind ?? '',
        tag: data.tag ?? '',
        text: data.text ?? data.linkText ?? data.title ?? '',
        imgAltMissing: data.imgAltMissing === true,
        ...(data.imgAlt !== undefined ? { imgAlt: data.imgAlt } : {}),
        referrers: Array.isArray(data.referrers)
            ? data.referrers.map((ref) => (
                typeof ref === 'string'
                    ? { href: ref, text: '' }
                    : {
                        href: ref.href ?? '',
                        text: ref.text ?? '',
                        rel: ref.rel ?? '',
                        tag: ref.tag ?? '',
                        kind: ref.kind ?? '',
                        relFollowAllowed: ref.relFollowAllowed ?? null,
                        relIndexAllowed: ref.relIndexAllowed ?? null,
                        relLabel: ref.relLabel ?? '',
                        imgAltMissing: ref.imgAltMissing === true,
                        ...(ref.imgAlt !== undefined ? { imgAlt: ref.imgAlt } : {}),
                        ...(Array.isArray(ref.imgAltStates) && ref.imgAltStates.length
                            ? {
                                imgAltStates: ref.imgAltStates.map((state) => ({
                                    tag: state.tag ?? '',
                                    imgAltMissing: state.imgAltMissing === true,
                                    ...(state.imgAlt !== undefined ? { imgAlt: state.imgAlt } : {}),
                                })),
                            }
                            : {}),
                    }
            ))
            : [],
        headings: Array.isArray(data.headings) ? data.headings.map((heading) => ({ ...heading })) : [],
        ogTitle: data.ogTitle ?? '',
        ogDescription: data.ogDescription ?? '',
        ogImage: data.ogImage ?? '',
    };
}

function buildSessionDumpPayload({
    scanResults,
    insertionOrder,
    startUrl,
    uiState,
    lastScanProgress,
    settings,
}) {
    const results = insertionOrder
        .map((url) => scanResults.get(url))
        .filter(Boolean)
        .map(cloneResultEntry);

    const payload = {
        version: SESSION_DUMP_VERSION,
        startUrl: startUrl || '',
        uiStateAtSave: uiState,
        progressAtSave: lastScanProgress ? { ...lastScanProgress } : null,
        insertionOrder: [...insertionOrder],
        results,
        resultCount: results.length,
    };
    if (settings && typeof settings === 'object') {
        payload.settings = { ...settings };
    }
    return payload;
}

function normalizeLoadedDump(dump) {
    if (!dump || dump.version !== SESSION_DUMP_VERSION || !Array.isArray(dump.results)) {
        throw new Error('Невірний формат файлу дампу.');
    }

    const insertionOrder = Array.isArray(dump.insertionOrder) && dump.insertionOrder.length > 0
        ? [...dump.insertionOrder]
        : dump.results.map((item) => item.url).filter(Boolean);

    const results = dump.results.map(cloneResultEntry);
    return {
        startUrl: dump.startUrl || '',
        savedAt: dump.savedAt || '',
        filePath: dump.filePath || '',
        progressAtSave: dump.progressAtSave || null,
        insertionOrder,
        results,
        settings: dump.settings && typeof dump.settings === 'object' ? { ...dump.settings } : null,
    };
}

function buildWorkspaceSnapshot({
    scanResults,
    insertionOrder,
    startUrl,
    lastScanProgress,
    selectedUrl,
    statusHint,
    filters,
}) {
    const results = insertionOrder
        .map((url) => scanResults.get(url))
        .filter(Boolean)
        .map(cloneResultEntry);

    return {
        version: WORKSPACE_VERSION,
        startUrl: startUrl || '',
        insertionOrder: [...insertionOrder],
        results,
        lastScanProgress: lastScanProgress ? { ...lastScanProgress } : null,
        selectedUrl: selectedUrl || null,
        statusHint: statusHint || '',
        filters: filters ? { ...filters } : null,
    };
}

function saveWorkspaceToSession(snapshot) {
    try {
        sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
        if (snapshot.selectedUrl) {
            sessionStorage.setItem(WORKSPACE_SELECTED_URL_KEY, snapshot.selectedUrl);
        } else {
            sessionStorage.removeItem(WORKSPACE_SELECTED_URL_KEY);
        }
    } catch (error) {
        console.error('Не вдалося зберегти стан робочої області:', error);
    }
}

function saveSelectedUrlToSession(selectedUrl) {
    try {
        if (!selectedUrl) {
            sessionStorage.removeItem(WORKSPACE_SELECTED_URL_KEY);
            return;
        }
        sessionStorage.setItem(WORKSPACE_SELECTED_URL_KEY, selectedUrl);
    } catch (error) {
        console.error('Не вдалося зберегти вибраний URL:', error);
    }
}

function loadSelectedUrlFromSession() {
    try {
        return sessionStorage.getItem(WORKSPACE_SELECTED_URL_KEY) || '';
    } catch {
        return '';
    }
}

function loadWorkspaceFromSession() {
    try {
        const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== WORKSPACE_VERSION || !Array.isArray(parsed.results)) {
            return null;
        }
        if (!parsed.selectedUrl) {
            const selectedUrl = loadSelectedUrlFromSession();
            if (selectedUrl) {
                parsed.selectedUrl = selectedUrl;
            }
        }
        return parsed;
    } catch {
        return null;
    }
}

function clearWorkspaceSession() {
    try {
        sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
        sessionStorage.removeItem(WORKSPACE_SELECTED_URL_KEY);
    } catch {
        // ignore
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SESSION_DUMP_VERSION,
        WORKSPACE_STORAGE_KEY,
        WORKSPACE_VERSION,
        cloneResultEntry,
        buildSessionDumpPayload,
        normalizeLoadedDump,
        buildWorkspaceSnapshot,
        saveWorkspaceToSession,
        saveSelectedUrlToSession,
        loadSelectedUrlFromSession,
        loadWorkspaceFromSession,
        clearWorkspaceSession,
    };
}
