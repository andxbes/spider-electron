/**
 * Ширини колонок таблиці результатів: colgroup, localStorage, drag-resize.
 */
(function initTableColumnLayout(root) {
const STORAGE_KEY = 'spider.resultsTableColumnWidths';
const MIN_COLUMN_WIDTH = 32;
const MAX_COLUMN_WIDTH = 640;

const DEFAULT_MIN_WIDTHS = {
    index: 36,
    url: 240,
    status: 56,
    contentType: 110,
    responseTimeMs: 72,
    metaRobots: 100,
    robotsTxt: 110,
    h1: 120,
    title: 150,
    metaDescription: 170,
    linkCount: 52,
    inCount: 52,
    internalCount: 58,
    externalCount: 58,
    ogTitle: 130,
    ogImage: 150,
};

function loadColumnWidths() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function saveColumnWidth(colId, width) {
    const widths = loadColumnWidths();
    widths[colId] = Math.round(width);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
}

function clearColumnWidth(colId) {
    const widths = loadColumnWidths();
    delete widths[colId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
}

function getDefaultColumnWidth(col) {
    return col.width
        || col.minWidth
        || DEFAULT_MIN_WIDTHS[col.id]
        || 88;
}

function getColumnWidth(col, savedWidths) {
    const saved = savedWidths[col.id];
    if (typeof saved === 'number' && saved >= MIN_COLUMN_WIDTH) {
        return saved;
    }
    return getDefaultColumnWidth(col);
}

function isColumnResizable(col) {
    return col.resizable !== false && col.id !== 'index';
}

function applyColgroup(tableEl, columns, savedWidths = loadColumnWidths()) {
    if (!tableEl?.querySelector || !tableEl?.insertBefore) {
        return savedWidths;
    }
    let colgroup = tableEl.querySelector('colgroup#resultsTableColgroup');
    if (!colgroup) {
        colgroup = document.createElement('colgroup');
        colgroup.id = 'resultsTableColgroup';
        tableEl.insertBefore(colgroup, tableEl.firstChild);
    }
    colgroup.innerHTML = columns.map((col) => {
        const width = getColumnWidth(col, savedWidths);
        return `<col data-col-id="${col.id}" style="width:${width}px">`;
    }).join('');
    return savedWidths;
}

function buildHeadCellHtml(col, sortState, savedWidths) {
    const label = col.thLabel || col.id || '';
    const width = getColumnWidth(col, savedWidths);
    const resizable = isColumnResizable(col);
    const resizeHandle = resizable
        ? `<span class="col-resize-handle" data-col-id="${col.id}" role="separator" aria-orientation="vertical" aria-label="Змінити ширину колонки" title="Перетягніть. Подвійний клік — скинути."></span>`
        : '';

    if (col.sortable === false || !col.sortKey) {
        return `<th data-col-id="${col.id}" style="width:${width}px" class="${col.thClass || 'p-2 font-semibold'} results-th">${escapeHtml(label)}${resizeHandle}</th>`;
    }

    const sortSuffix = sortState.column === col.sortKey
        ? ` ${sortState.direction === 'asc' ? '▲' : '▼'}`
        : '';
    const activeClass = sortState.column === col.sortKey ? ' bg-zinc-200 text-zinc-800' : '';
    return `<th data-col-id="${col.id}" style="width:${width}px" class="${col.thClass || 'sortable-th p-2 font-semibold cursor-pointer select-none hover:bg-zinc-200'}${activeClass} results-th" data-sort="${escapeHtml(col.sortKey)}" title="Сортувати">${escapeHtml(label)}${sortSuffix}${resizeHandle}</th>`;
}

function renderResultsTableHead(tableEl, headEl, columns, sortState) {
    if (!tableEl || !headEl) {
        return;
    }
    const savedWidths = applyColgroup(tableEl, columns);
    const cells = columns.map((col) => buildHeadCellHtml(col, sortState, savedWidths)).join('');
    headEl.innerHTML = `<tr class="text-left text-zinc-600">${cells}</tr>`;
}

function bindResultsTableColumnResize(tableEl, headEl, onColumnWidthReset) {
    if (!tableEl || !headEl || headEl.dataset.resizeBound) {
        return;
    }

    let active = null;

    function finishResize() {
        if (!active) {
            return;
        }
        document.body.classList.remove('table-col-resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        active = null;
    }

    function onMouseMove(event) {
        if (!active) {
            return;
        }
        const delta = event.clientX - active.startX;
        const nextWidth = Math.min(
            MAX_COLUMN_WIDTH,
            Math.max(MIN_COLUMN_WIDTH, active.startWidth + delta)
        );
        const colEl = tableEl.querySelector(`colgroup col[data-col-id="${active.colId}"]`);
        const thEl = headEl.querySelector(`th[data-col-id="${active.colId}"]`);
        if (colEl) {
            colEl.style.width = `${nextWidth}px`;
        }
        if (thEl) {
            thEl.style.width = `${nextWidth}px`;
        }
    }

    function onMouseUp() {
        if (!active) {
            return;
        }
        const colEl = tableEl.querySelector(`colgroup col[data-col-id="${active.colId}"]`);
        const width = colEl ? parseInt(colEl.style.width, 10) : active.startWidth;
        if (Number.isFinite(width)) {
            saveColumnWidth(active.colId, width);
        }
        finishResize();
    }

    headEl.addEventListener('mousedown', (event) => {
        const handle = event.target.closest('.col-resize-handle');
        if (!handle || !tableEl.querySelector) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const colId = handle.dataset.colId;
        const colEl = tableEl.querySelector(`colgroup col[data-col-id="${colId}"]`);
        const startWidth = colEl
            ? parseInt(colEl.style.width, 10) || getDefaultColumnWidth({ id: colId })
            : getDefaultColumnWidth({ id: colId });
        active = { colId, startX: event.clientX, startWidth };
        document.body.classList.add('table-col-resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    headEl.addEventListener('dblclick', (event) => {
        const handle = event.target.closest('.col-resize-handle');
        if (!handle) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const colId = handle.dataset.colId;
        clearColumnWidth(colId);
        if (typeof onColumnWidthReset === 'function') {
            onColumnWidthReset(colId);
        }
    });

    headEl.dataset.resizeBound = '1';
}

const exported = {
    STORAGE_KEY,
    DEFAULT_MIN_WIDTHS,
    loadColumnWidths,
    saveColumnWidth,
    clearColumnWidth,
    getColumnWidth,
    applyColgroup,
    renderResultsTableHead,
    bindResultsTableColumnResize,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
}
Object.assign(root, exported);
})(typeof globalThis !== 'undefined' ? globalThis : window);
