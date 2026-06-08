const urlInput = document.getElementById('urlInput');
const startButton = document.getElementById('startButton');
const exportButton = document.getElementById('exportButton');
const resultsTable = document.getElementById('resultsTable');
const detailContent = document.getElementById('detailContent');
const selectedUrlHint = document.getElementById('selectedUrlHint');
const statusText = document.getElementById('status-text');
const statusScanned = document.getElementById('status-scanned');
const statusQueue = document.getElementById('status-queue');

const scanResults = new Map();
const insertionOrder = [];
let selectedUrl = null;
let activeTab = 'details';
let sortState = { column: null, direction: 'asc' };

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

function statusSortValue(status) {
    if (typeof status === 'number') return status;
    if (status === 'ERROR') return 10000;
    if (status === 'SKIPPED') return 9999;
    return 5000;
}

function truncate(str, len = 80) {
    const s = String(str ?? '');
    return s.length > len ? `${s.slice(0, len)}…` : s;
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
        <td class="p-2 break-all text-blue-700">${escapeHtml(data.url)}</td>
        <td class="p-2"><span class="font-mono font-semibold ${statusRowClass(data.status)}">${escapeHtml(data.status)}</span></td>
        <td class="p-2" title="${escapeHtml(data.title)}">${escapeHtml(truncate(data.title, 50))}</td>
        <td class="p-2" title="${escapeHtml(data.metaDescription)}">${escapeHtml(truncate(data.metaDescription, 60))}</td>
        <td class="p-2 text-center">${linkCount}</td>
        <td class="p-2 text-center">${inCount}</td>
    `;
    tr.addEventListener('click', () => selectRow(data.url));
    return tr;
}

function refreshTable() {
    const entries = Array.from(scanResults.values());
    if (sortState.column) {
        entries.sort(compareRows);
    } else {
        entries.sort((a, b) => insertionOrder.indexOf(a.url) - insertionOrder.indexOf(b.url));
    }

    resultsTable.innerHTML = '';
    entries.forEach((data, i) => {
        resultsTable.appendChild(createTableRow(data, i + 1));
    });
}

function upsertScanResult(data) {
    if (!data.outlinks) {
        data.outlinks = [];
    }
    if (!scanResults.has(data.url)) {
        insertionOrder.push(data.url);
    }
    scanResults.set(data.url, data);
    refreshTable();
    if (!selectedUrl) {
        selectRow(data.url);
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
        refreshTable();
    });
});

function selectRow(url) {
    selectedUrl = url;
    document.querySelectorAll('#resultsTable tr').forEach((tr) => {
        tr.classList.toggle('bg-blue-50', tr.dataset.url === url);
    });
    selectedUrlHint.textContent = truncate(url, 60);
    renderDetailPanel();
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
            <td class="p-2 break-all text-blue-700">${escapeHtml(link.href || link)}</td>
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
        ['Address', escapeHtml(data.url)],
        ['Status Code', escapeHtml(data.status)],
        ['Title', escapeHtml(data.title)],
        ['Title Length', data.title ? String(data.title.length) : '0'],
        ['Meta Description', escapeHtml(data.metaDescription) || '<span class="text-zinc-400 italic">—</span>'],
        ['Meta Description Length', data.metaDescription ? String(data.metaDescription.length) : '0'],
        ['Canonical', escapeHtml(data.metaCanonical) || '<span class="text-zinc-400 italic">—</span>'],
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
        rows.push(['Redirect URL', escapeHtml(data.redirectUrl)]);
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
    const headers = ['URL', 'Status', 'Title', 'Meta Description', 'Canonical', 'Link Count', 'Redirect URL', 'Referrers', 'Headings'];
    const csvRows = [headers.join(',')];

    for (const [, data] of scanResults) {
        const referrers = data.referrers ? data.referrers.join('; ') : '';
        const headings = data.headings ? data.headings.map((h) => `H${h.level}: ${h.text}`).join('; ') : '';
        const row = [
            `"${(data.url || '').replace(/"/g, '""')}"`,
            `"${(data.status || '')}"`,
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

startButton.addEventListener('click', async () => {
    const startUrl = urlInput.value.trim();
    try {
        new URL(startUrl);
        scanResults.clear();
        insertionOrder.length = 0;
        selectedUrl = null;
        sortState = { column: null, direction: 'asc' };
        updateSortIndicators();
        resultsTable.innerHTML = '';
        selectedUrlHint.textContent = 'Оберіть рядок у таблиці';
        detailContent.innerHTML = '<p class="p-4 text-zinc-400 italic">Оберіть URL у таблиці вище</p>';
        exportButton.disabled = true;
        statusText.textContent = `Починаю сканування з ${startUrl}...`;
        startButton.disabled = true;

        const settings = await loadSettings();
        await saveSettings({
            ...settings,
            lastStartUrl: startUrl,
        });

        window.api.startSpider(startUrl, {
            useSitemap: settings.useSitemap,
            maxPages: settings.maxPages,
        });
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
    startButton.disabled = false;
    exportButton.disabled = false;
});

window.api.onSpiderProgress((progress) => {
    statusText.textContent = progress.status || 'В процесі...';
    statusScanned.textContent = `Проскановано: ${progress.scanned}`;
    statusQueue.textContent = `У черзі: ${progress.queue}`;
});

(async function initMainPage() {
    const settings = await loadSettings();
    if (settings.lastStartUrl) {
        urlInput.value = settings.lastStartUrl;
    }
})();
