const SESSION_DUMP_VERSION = 1;

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
        robotsAllowed: data.robotsAllowed ?? null,
        robotsRule: data.robotsRule ?? '',
        responseTimeMs: data.responseTimeMs ?? null,
        redirectUrl: data.redirectUrl ?? '',
        linkCount: data.linkCount ?? 0,
        referrers: Array.isArray(data.referrers) ? [...data.referrers] : [],
        outlinks: Array.isArray(data.outlinks) ? data.outlinks.map((link) => ({ ...link })) : [],
        headings: Array.isArray(data.headings) ? data.headings.map((heading) => ({ ...heading })) : [],
    };
}

function buildSessionDumpPayload({
    scanResults,
    insertionOrder,
    startUrl,
    uiState,
    lastScanProgress,
}) {
    const results = insertionOrder
        .map((url) => scanResults.get(url))
        .filter(Boolean)
        .map(cloneResultEntry);

    return {
        version: SESSION_DUMP_VERSION,
        startUrl: startUrl || '',
        uiStateAtSave: uiState,
        progressAtSave: lastScanProgress ? { ...lastScanProgress } : null,
        insertionOrder: [...insertionOrder],
        results,
        resultCount: results.length,
    };
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
    };
}
