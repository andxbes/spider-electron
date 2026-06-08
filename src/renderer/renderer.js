const urlInput = document.getElementById('urlInput');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const resumeButton = document.getElementById('resumeButton');
const restartButton = document.getElementById('restartButton');
const exportButton = document.getElementById('exportButton');
const controlsIdle = document.getElementById('controlsIdle');
const controlsRunning = document.getElementById('controlsRunning');
const controlsPaused = document.getElementById('controlsPaused');
const resultsTable = document.getElementById('resultsTable');
const detailContent = document.getElementById('detailContent');
const selectedUrlHint = document.getElementById('selectedUrlHint');
const selectedUrlBar = document.getElementById('selectedUrlBar');
const statusText = document.getElementById('status-text');
const statusScanned = document.getElementById('status-scanned');
const statusQueue = document.getElementById('status-queue');
const statusActive = document.getElementById('status-active');
const contentTypeFilter = document.getElementById('contentTypeFilter');
const statusFilter = document.getElementById('statusFilter');
const filterCount = document.getElementById('filterCount');

const scanResults = new Map();
const insertionOrder = [];
let selectedUrl = null;
let activeTab = 'details';
let sortState = { column: null, direction: 'asc' };
/** @type {'all' | 'html' | 'media'} */
let activeContentFilter = 'all';
/** @type {string} */
let activeStatusFilter = 'all';
/** @type {'idle' | 'running' | 'paused'} */
let uiState = 'idle';
let knownStatusCodes = new Set();
let refreshTableTimer = null;
const REFRESH_TABLE_DELAY_MS = 120;

const MEDIA_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff',
    'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv',
    'mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a',
    'pdf', 'zip', 'gz', 'rar', '7z', 'tar',
    'css', 'js', 'mjs', 'map',
    'woff', 'woff2', 'ttf', 'eot', 'otf',
    'xml', 'json', 'txt', 'csv',
]);

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function statusRowClass(status) {
    if (status === 200) return 'text-green-700';
    if (status === 'SKIPPED') return 'text-yellow-700';
    if (status === 'ERROR' || (typeof status === 'number' && status >= 400)) return 'text-red-700';
    if (typeof status === 'number' && status >= 300 && status < 400) return 'text-blue-700';
    return 'text-zinc-600';
}

function indexingStateClass(kind, status, allowed) {
    if (kind === 'meta') {
        if (status === 'none') return 'text-zinc-400';
        if (status === 'allowed') return 'text-green-700';
        return 'text-red-700';
    }
    if (allowed === null || allowed === undefined) return 'text-zinc-400';
    return allowed ? 'text-green-700' : 'text-red-700';
}

function metaRobotsCellHtml(data) {
    const status = data.metaRobotsStatus || 'none';
    if (status === 'none') {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const label = data.metaRobotsLabel || data.metaRobots || 'index, follow';
    const cls = indexingStateClass('meta', status);
    const title = status === 'allowed'
        ? 'Дозволено для індексації та обходу'
        : 'Закрито (noindex / nofollow)';
    return `<span class="${cls} font-medium" title="${escapeHtml(title)}: ${escapeHtml(label)}">${escapeHtml(truncate(label, 28))}</span>`;
}

function robotsTxtCellHtml(data) {
    if (data.robotsAllowed === null && !data.robotsRule) {
        return '<span class="text-zinc-400 italic">—</span>';
    }
    const allowed = data.robotsAllowed !== false;
    const rule = data.robotsRule || (allowed ? 'Дозволено' : 'Заборонено');
    const cls = indexingStateClass('robots', null, data.robotsAllowed);
    const title = allowed ? `Дозволено: ${rule}` : `Заборонено: ${rule}`;
    return `<span class="${cls} font-medium" title="${escapeHtml(title)}">${escapeHtml(truncate(rule, 32))}</span>`;
}

function statusSortValue(status) {
    if (typeof status === 'number') return status;
    if (status === 'ERROR') return 10000;
    if (status === 'SKIPPED') return 9999;
    return 5000;
}

function getUrlExtension(url) {
    try {
        const pathname = new URL(url).pathname;
        const lastSegment = pathname.split('/').pop() || '';
        const dotIndex = lastSegment.lastIndexOf('.');
        if (dotIndex <= 0) {
            return '';
        }
        return lastSegment.slice(dotIndex + 1).toLowerCase();
    } catch {
        return '';
    }
}

function getResourceType(data) {
    const contentType = (data.contentType || '').toLowerCase();

    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        return 'html';
    }
    if (
        contentType.startsWith('image/')
        || contentType.startsWith('video/')
        || contentType.startsWith('audio/')
        || contentType.includes('font')
        || contentType === 'text/css'
        || contentType.includes('javascript')
        || contentType === 'application/pdf'
        || contentType === 'application/json'
        || contentType.includes('xml')
    ) {
        return 'media';
    }

    const extension = getUrlExtension(data.url);
    if (MEDIA_EXTENSIONS.has(extension)) {
        return 'media';
    }

    if (typeof data.status === 'number' && data.status >= 300 && data.status < 400) {
        return 'html';
    }

    if (data.outlinks?.length || data.headings?.length || data.metaDescription) {
        return 'html';
    }

    return 'html';
}

function matchesStatusFilter(status, filter) {
    if (filter === 'all') {
        return true;
    }
    if (filter === '2xx') {
        return typeof status === 'number' && status >= 200 && status < 300;
    }
    if (filter === '3xx') {
        return typeof status === 'number' && status >= 300 && status < 400;
    }
    if (filter === '4xx') {
        return typeof status === 'number' && status >= 400 && status < 500;
    }
    if (filter === '5xx') {
        return typeof status === 'number' && status >= 500 && status < 600;
    }
    return String(status) === filter;
}

function passesTableFilters(data) {
    if (activeContentFilter !== 'all' && getResourceType(data) !== activeContentFilter) {
        return false;
    }
    return matchesStatusFilter(data.status, activeStatusFilter);
}

function getFilteredResults() {
    return Array.from(scanResults.values()).filter(passesTableFilters);
}

function updateStatusFilterOptions({ force = false } = {}) {
    if (!statusFilter) {
        return;
    }

    const numericStatuses = new Set();
    for (const data of scanResults.values()) {
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
        { value: 'SKIPPED', label: 'SKIPPED' },
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

function updateFilterCount(shown, total) {
    if (!filterCount) {
        return;
    }
    if (shown === total) {
        filterCount.textContent = total > 0 ? `Усього: ${total}` : '';
    } else {
        filterCount.textContent = `Показано: ${shown} з ${total}`;
    }
}

function resetTableFilters() {
    activeContentFilter = 'all';
    activeStatusFilter = 'all';
    knownStatusCodes = new Set();
    if (contentTypeFilter) {
        contentTypeFilter.value = 'all';
    }
    if (statusFilter) {
        statusFilter.value = 'all';
    }
    updateStatusFilterOptions({ force: true });
}

function truncate(str, len = 80) {
    const s = String(str ?? '');
    return s.length > len ? `${s.slice(0, len)}…` : s;
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
    return `<span class="inline-flex items-start gap-1 min-w-0 max-w-full">
        <span class="text-blue-700 break-all">${escapeHtml(url)}</span>
        ${urlActionButtons(url)}
    </span>`;
}

function decodeUrlAttr(encoded) {
    try {
        return decodeURIComponent(encoded);
    } catch {
        return encoded;
    }
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
    const hasData = scanResults.size > 0;
    exportButton.disabled = !hasData;
    exportButton.classList.toggle('hidden', !hasData);
}

function setUIState(state) {
    uiState = state;
    controlsIdle.classList.toggle('hidden', state !== 'idle');
    controlsRunning.classList.toggle('hidden', state !== 'running');
    controlsPaused.classList.toggle('hidden', state !== 'paused');
    urlInput.disabled = state === 'running';
    if (state === 'idle') {
        updateExportButton();
    }
}

function clearScanResults() {
    scanResults.clear();
    insertionOrder.length = 0;
    selectedUrl = null;
    sortState = { column: null, direction: 'asc' };
    updateSortIndicators();
    resultsTable.innerHTML = '';
    selectedUrlHint.textContent = 'Оберіть рядок у таблиці';
    if (selectedUrlBar) {
        selectedUrlBar.querySelectorAll('.url-copy, .url-open').forEach((el) => el.remove());
    }
    detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть URL у таблиці вище</p>';
    resetTableFilters();
    updateExportButton();
}

async function beginScan(startUrl, { clearResults = true } = {}) {
    if (clearResults) {
        clearScanResults();
    }
    setUIState('running');
    statusText.textContent = `Починаю сканування з ${startUrl}...`;

    const settings = await loadSettings();
    window.api.startSpider(startUrl, {
        useSitemap: settings.useSitemap,
        maxPages: settings.maxPages,
        concurrency: settings.concurrency,
    });
}

function getRowMetrics(data) {
    return {
        inCount: data.referrers?.length || 0,
        linkCount: data.linkCount ?? (data.outlinks?.length || 0),
    };
}

function compareRows(a, b) {
    const { column, direction } = sortState;
    const mul = direction === 'asc' ? 1 : -1;
    const ma = getRowMetrics(a);
    const mb = getRowMetrics(b);

    let va;
    let vb;
    switch (column) {
        case 'index':
            va = insertionOrder.indexOf(a.url);
            vb = insertionOrder.indexOf(b.url);
            break;
        case 'url':
            va = a.url;
            vb = b.url;
            break;
        case 'status':
            va = statusSortValue(a.status);
            vb = statusSortValue(b.status);
            break;
        case 'title':
            va = (a.title || '').toLowerCase();
            vb = (b.title || '').toLowerCase();
            break;
        case 'metaDescription':
            va = (a.metaDescription || '').toLowerCase();
            vb = (b.metaDescription || '').toLowerCase();
            break;
        case 'links':
            va = ma.linkCount;
            vb = mb.linkCount;
            break;
        case 'inlinks':
            va = ma.inCount;
            vb = mb.inCount;
            break;
        default:
            va = insertionOrder.indexOf(a.url);
            vb = insertionOrder.indexOf(b.url);
    }

    if (va < vb) return -1 * mul;
    if (va > vb) return 1 * mul;
    return a.url.localeCompare(b.url) * mul;
}

function updateSortIndicators() {
    document.querySelectorAll('.sortable-th').forEach((th) => {
        const col = th.dataset.sort;
        const base = th.textContent.replace(/ [▲▼]$/, '');
        if (sortState.column === col) {
            th.textContent = `${base} ${sortState.direction === 'asc' ? '▲' : '▼'}`;
            th.classList.add('bg-zinc-200', 'text-zinc-800');
        } else {
            th.textContent = base;
            th.classList.remove('bg-zinc-200', 'text-zinc-800');
        }
    });
}

function createTableRow(data, displayIndex) {
    const { inCount, linkCount } = getRowMetrics(data);
    const tr = document.createElement('tr');
    tr.dataset.url = data.url;
    tr.className = 'border-b border-zinc-100 cursor-pointer hover:bg-zinc-50';
    if (selectedUrl === data.url) {
        tr.classList.add('bg-blue-50');
    }
    tr.innerHTML = `
        <td class="p-2 text-zinc-400">${displayIndex}</td>
        <td class="p-2">${urlCellHtml(data.url)}</td>
        <td class="p-2"><span class="font-mono font-semibold ${statusRowClass(data.status)}">${escapeHtml(data.status)}</span></td>
        <td class="p-2">${metaRobotsCellHtml(data)}</td>
        <td class="p-2">${robotsTxtCellHtml(data)}</td>
        <td class="p-2" title="${escapeHtml(data.title)}">${escapeHtml(truncate(data.title, 50))}</td>
        <td class="p-2" title="${escapeHtml(data.metaDescription)}">${escapeHtml(truncate(data.metaDescription, 60))}</td>
        <td class="p-2 text-center">${linkCount}</td>
        <td class="p-2 text-center">${inCount}</td>
    `;
    tr.addEventListener('click', (e) => {
        if (e.target.closest('.url-copy, .url-open')) {
            return;
        }
        selectRow(data.url);
    });
    return tr;
}

function refreshTable() {
    updateStatusFilterOptions();

    const entries = getFilteredResults();
    if (sortState.column) {
        entries.sort(compareRows);
    } else {
        entries.sort((a, b) => insertionOrder.indexOf(a.url) - insertionOrder.indexOf(b.url));
    }

    resultsTable.innerHTML = '';
    entries.forEach((data, i) => {
        resultsTable.appendChild(createTableRow(data, i + 1));
    });

    updateFilterCount(entries.length, scanResults.size);

    if (selectedUrl && !entries.some((row) => row.url === selectedUrl)) {
        document.querySelectorAll('#resultsTable tr').forEach((tr) => {
            tr.classList.remove('bg-blue-50');
        });
    } else if (selectedUrl && scanResults.has(selectedUrl)) {
        syncSelectedRowUi();
    }
}

function syncSelectedRowUi() {
    if (!selectedUrl || !scanResults.has(selectedUrl)) {
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

function upsertScanResult(data) {
    if (!data.outlinks) {
        data.outlinks = [];
    }
    const isNew = !scanResults.has(data.url);
    if (isNew) {
        insertionOrder.push(data.url);
    }
    scanResults.set(data.url, data);
    requestRefreshTable();

    if (isNew && !selectedUrl) {
        selectedUrl = data.url;
    } else if (selectedUrl === data.url) {
        renderDetailPanel();
    }
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

if (contentTypeFilter) {
    contentTypeFilter.addEventListener('change', () => {
        activeContentFilter = contentTypeFilter.value;
        requestRefreshTable({ immediate: true });
    });
}

if (statusFilter) {
    statusFilter.addEventListener('change', () => {
        activeStatusFilter = statusFilter.value;
        requestRefreshTable({ immediate: true });
    });
}

document.querySelectorAll('.sortable-th').forEach((th) => {
    th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (sortState.column === col) {
            sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.column = col;
            sortState.direction = 'asc';
        }
        updateSortIndicators();
        requestRefreshTable({ immediate: true });
    });
});

function selectRow(url) {
    selectedUrl = url;
    document.querySelectorAll('#resultsTable tr').forEach((tr) => {
        tr.classList.toggle('bg-blue-50', tr.dataset.url === url);
    });
    syncSelectedRowUi();
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

function renderLinkTable(links, emptyText) {
    if (!links || links.length === 0) {
        return `<p class="p-4 text-zinc-400 italic">${escapeHtml(emptyText)}</p>`;
    }
    const rows = links
        .map(
            (link) => `
        <tr class="border-b border-zinc-100 hover:bg-zinc-50">
            <td class="p-2">${urlCellHtml(link.href || link)}</td>
            <td class="p-2 text-zinc-600">${escapeHtml(link.text || '')}</td>
        </tr>`
        )
        .join('');
    return `<table class="w-full border-collapse">
        <thead class="bg-zinc-50 sticky top-0">
            <tr class="text-left text-zinc-500">
                <th class="p-2 font-semibold">URL</th>
                <th class="p-2 font-semibold w-1/3">Текст посилання</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function buildDetailRows(data) {
    const h1 = (data.headings || []).find((h) => h.level === 1);
    const h2List = (data.headings || []).filter((h) => h.level === 2);
    const { inCount, linkCount } = getRowMetrics(data);

    const rows = [
        ['Address', urlCellHtml(data.url)],
        ['Status Code', escapeHtml(data.status)],
        ['Content-Type', escapeHtml(data.contentType) || '<span class="text-zinc-400 italic">—</span>'],
        ['Resource Type', getResourceType(data) === 'html' ? 'HTML' : 'Медіа'],
        ['Title', escapeHtml(data.title)],
        ['Title Length', data.title ? String(data.title.length) : '0'],
        ['Meta Description', escapeHtml(data.metaDescription) || '<span class="text-zinc-400 italic">—</span>'],
        ['Meta Description Length', data.metaDescription ? String(data.metaDescription.length) : '0'],
        ['Canonical', data.metaCanonical ? urlCellHtml(data.metaCanonical) : '<span class="text-zinc-400 italic">—</span>'],
        ['Meta robots', metaRobotsCellHtml(data)],
        ['Robots.txt', robotsTxtCellHtml(data)],
        ['H1', escapeHtml(h1?.text) || '<span class="text-zinc-400 italic">—</span>'],
        [
            'H2',
            h2List.length
                ? h2List.map((h) => escapeHtml(h.text)).join('<br>')
                : '<span class="text-zinc-400 italic">—</span>',
        ],
        ['Вихідних посилань', String(linkCount)],
        ['Вхідних посилань', String(inCount)],
    ];

    if (data.redirectUrl) {
        rows.push(['Redirect URL', urlCellHtml(data.redirectUrl)]);
    }

    return rows;
}

function renderDetailPanel() {
    if (!selectedUrl || !scanResults.has(selectedUrl)) {
        detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть URL у таблиці вище</p>';
        return;
    }

    const data = scanResults.get(selectedUrl);

    if (activeTab === 'details') {
        detailContent.innerHTML = renderDetailTable(buildDetailRows(data));
    } else if (activeTab === 'inlinks') {
        const inlinks = (data.referrers || []).map((href) => ({ href, text: '' }));
        detailContent.innerHTML = renderLinkTable(
            inlinks,
            'Немає вхідних посилань (стартова або лише з sitemap)'
        );
    } else if (activeTab === 'outlinks') {
        detailContent.innerHTML = renderLinkTable(
            data.outlinks || [],
            'Немає вихідних посилань на сторінці'
        );
    }
}

exportButton.addEventListener('click', () => {
    if (scanResults.size === 0) return;

    const bom = '\uFEFF';
    const headers = ['URL', 'Status', 'Meta Robots', 'Robots.txt Rule', 'Robots.txt Allowed', 'Content-Type', 'Resource Type', 'Title', 'Meta Description', 'Canonical', 'Link Count', 'Redirect URL', 'Referrers', 'Headings'];
    const csvRows = [headers.join(',')];

    for (const data of getFilteredResults()) {
        const referrers = data.referrers ? data.referrers.join('; ') : '';
        const headings = data.headings ? data.headings.map((h) => `H${h.level}: ${h.text}`).join('; ') : '';
        const row = [
            `"${(data.url || '').replace(/"/g, '""')}"`,
            `"${(data.status || '')}"`,
            `"${(data.metaRobotsLabel || data.metaRobots || '').replace(/"/g, '""')}"`,
            `"${(data.robotsRule || '').replace(/"/g, '""')}"`,
            `"${data.robotsAllowed === false ? 'Заборонено' : (data.robotsAllowed ? 'Дозволено' : '')}"`,
            `"${(data.contentType || '').replace(/"/g, '""')}"`,
            `"${getResourceType(data)}"`,
            `"${(data.title || '').replace(/"/g, '""')}"`,
            `"${(data.metaDescription || '').replace(/"/g, '""')}"`,
            `"${(data.metaCanonical || '').replace(/"/g, '""')}"`,
            `"${(data.linkCount || 0)}"`,
            `"${(data.redirectUrl || '').replace(/"/g, '""')}"`,
            `"${referrers.replace(/"/g, '""')}"`,
            `"${headings.replace(/"/g, '""')}"`,
        ];
        csvRows.push(row.join(','));
    }

    const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `spider_results_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
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
    if (refreshTableTimer) {
        clearTimeout(refreshTableTimer);
        refreshTableTimer = null;
    }
    requestRefreshTable({ immediate: true });
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

window.api.onSpiderReferrersUpdate((allReferrers) => {
    for (const [url, refs] of Object.entries(allReferrers)) {
        if (scanResults.has(url)) {
            const data = scanResults.get(url);
            data.referrers = refs;
            upsertScanResult(data);
        }
    }
});

window.api.onSpiderEnd((message) => {
    statusText.textContent = message;
    setUIState('idle');
    requestRefreshTable({ immediate: true });
});

window.api.onSpiderProgress((progress) => {
    // Лише синхронізуємо паузу з бекенду; не відновлюємо running автоматично —
    // інакше завершення воркерів до обробки pause IPC повертає кнопку «Зупинити».
    if (progress.paused && uiState === 'running') {
        setUIState('paused');
    }
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

    window.addEventListener('resize', () => {
        setPanelHeight(panel.getBoundingClientRect().height);
    });
}

initDetailPanelResize();
setUIState('idle');
