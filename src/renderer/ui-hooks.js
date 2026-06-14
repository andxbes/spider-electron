(function initUiHooks(root) {
const { createHookRegistry } = root.HookRegistryModule;

const UI_HOOKS = {
    /** (ctx, result) => result — трансформація при збереженні */
    TRANSFORM_RESULT: 'ui:transformResult',
    /** (ctx, columns[]) => columns[] — колонки таблиці */
    TABLE_COLUMNS: 'ui:tableColumns',
    /** (ctx, rows[]) => rows[] — рядки панелі деталей [name, htmlValue][] */
    DETAIL_ROWS: 'ui:detailRows',
    /** (ctx, columns[]) => columns[] — колонки CSV { id, header, value(data, ctx) } */
    EXPORT_COLUMNS: 'ui:exportColumns',
};

const uiHookRegistry = createHookRegistry({ name: 'ui' });

function registerDefaultUiHooks() {
    uiHookRegistry.register(UI_HOOKS.TRANSFORM_RESULT, (_ctx, result) => result, {
        priority: 0,
        id: 'default-transform-result',
    });
}

registerDefaultUiHooks();

function transformStoredResult(ctx, result) {
    return uiHookRegistry.runWaterfallSync(UI_HOOKS.TRANSFORM_RESULT, ctx, result);
}

function resolveTableColumns(ctx) {
    return uiHookRegistry.runWaterfallSync(UI_HOOKS.TABLE_COLUMNS, ctx, null) || [];
}

function resolveDetailRows(ctx, data) {
    return uiHookRegistry.runWaterfallSync(UI_HOOKS.DETAIL_ROWS, ctx, null) || [];
}

function resolveExportColumns(ctx) {
    return uiHookRegistry.runWaterfallSync(UI_HOOKS.EXPORT_COLUMNS, ctx, null) || [];
}

const exported = {
    UI_HOOKS,
    uiHookRegistry,
    registerDefaultUiHooks,
    transformStoredResult,
    resolveTableColumns,
    resolveDetailRows,
    resolveExportColumns,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
