const urlInput = document.getElementById('urlInput');
const startButton = document.getElementById('startButton');
const resultsDiv = document.getElementById('results');
const statusText = document.getElementById('status-text');
const statusScanned = document.getElementById('status-scanned');
const statusQueue = document.getElementById('status-queue');

// Отправляем событие в основной процесс при клике на кнопку
startButton.addEventListener('click', () => {
    const startUrl = urlInput.value.trim();
    try {
        // Простая валидация URL
        new URL(startUrl);
        resultsDiv.innerHTML = ''; // Очищаем предыдущие результаты
        statusText.textContent = `Начинаю сканирование с ${startUrl}...`;
        startButton.disabled = true;
        // Используем API, предоставленное через preload.js
        window.api.startSpider(startUrl);
    } catch (e) {
        alert('Пожалуйста, введите корректный URL (например, https://example.com).');
    }
});

// Слушаем событие 'spider-result' от основного процесса
window.api.onSpiderResult((data) => {
    const resultWrapper = document.createElement('div');
    resultWrapper.className = 'border-b border-zinc-200';
    resultWrapper.dataset.url = data.url;

    let statusClass = 'text-zinc-500';
    if (data.status === 200) statusClass = 'text-green-600';
    if (data.status === 'ERROR' || data.status >= 400) statusClass = 'text-red-600';
    if (data.status === 'SKIPPED') statusClass = 'text-yellow-600';
    if (data.status >= 300 && data.status < 400) statusClass = 'text-blue-600';

    const headingsHTML = data.headings.map(h => `
        <div class="ml-4 text-sm text-zinc-600">
            <span class="font-mono font-bold">H${h.level}</span>: ${h.text}
        </div>
    `).join('');

    const referrersHTML = (data.referrers && data.referrers.length > 0)
        ? data.referrers.map(r => `<div class="truncate" title="${r}">${r}</div>`).join('')
        : '<span class="text-zinc-400">Нет (стартовая страница)</span>';

    const redirectHTML = data.redirectUrl
        ? `<div class="mb-2 p-2 bg-blue-50 border border-blue-100 rounded text-blue-800">
             <strong>➡ Редирект на:</strong> <a href="#" class="underline break-all">${data.redirectUrl}</a>
           </div>` : '';

    resultWrapper.innerHTML = `
        <button class="p-2 w-full text-left hover:bg-zinc-50 focus:outline-none">
            <div class="flex justify-between items-center">
                <div class="flex-1 truncate">
                    <span class="font-bold ${statusClass}">[${data.status}]</span>
                    <span class="text-blue-700 ml-2">${data.title}</span>
                    <span class="text-sm text-slate-500 block truncate">${data.url}</span>
                </div>
                <svg class="w-4 h-4 text-zinc-500 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
        </button>
        <div class="details hidden p-4 bg-zinc-50 border-t border-zinc-200 text-sm">
            ${redirectHTML}
            <div class="mb-2">
                <strong>Meta Description:</strong> <span class="text-zinc-600">${data.metaDescription || '<span class="italic text-zinc-400">Не указано</span>'}</span>
            </div>
            <div class="mb-2">
                <strong>Canonical:</strong> <span class="text-zinc-600">${data.metaCanonical || '<span class="italic text-zinc-400">Не указано</span>'}</span>
            </div>
            <div class="mb-2">
                <strong>Referrers:</strong>
                <div class="referrers-container ml-2 text-zinc-600 max-h-20 overflow-y-auto border border-zinc-200 p-1 rounded bg-white">${referrersHTML}</div>
            </div>
            <p><strong>Найдено ссылок:</strong> <span class="text-zinc-600">${data.linkCount}</span></p>
            <p class="mt-2"><strong>Заголовки:</strong></p>
            ${headingsHTML || '<p class="ml-4 text-sm text-zinc-500">Не найдено.</p>'}
        </div>
    `;

    resultsDiv.appendChild(resultWrapper);
    resultsDiv.scrollTop = resultsDiv.scrollHeight; // Автопрокрутка вниз

    resultWrapper.querySelector('button').addEventListener('click', (e) => {
        const details = e.currentTarget.nextElementSibling;
        details.classList.toggle('hidden');
        e.currentTarget.querySelector('svg').classList.toggle('rotate-180');
    });
});

// Слушаем событие обновления рефереров после завершения сканирования
window.api.onSpiderReferrersUpdate((allReferrers) => {
    const items = document.querySelectorAll('#results > div');
    items.forEach(item => {
        const url = item.dataset.url;
        if (url && allReferrers[url]) {
            const container = item.querySelector('.referrers-container');
            if (container) {
                const refs = allReferrers[url];
                const newHTML = (refs && refs.length > 0)
                    ? refs.map(r => `<div class="truncate" title="${r}">${r}</div>`).join('')
                    : '<span class="text-zinc-400">Нет (стартовая страница)</span>';
                container.innerHTML = newHTML;
            }
        }
    });
});

// Слушаем событие об окончании сканирования
window.api.onSpiderEnd((message) => {
    statusText.textContent = message;
    startButton.disabled = false;
});

// Слушаем событие о прогрессе сканирования
window.api.onSpiderProgress((progress) => {
    statusText.textContent = 'В процессе...';
    statusScanned.textContent = `Просканировано: ${progress.scanned}`;
    statusQueue.textContent = `В очереди: ${progress.queue}`;
});
