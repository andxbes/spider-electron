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
    const item = document.createElement('div');
    item.className = 'result-item';

    const statusClass = data.status === 'ERROR' ? 'status-error' : 'status-ok';

    item.innerHTML = `[<span class="${statusClass}">${data.status}</span>] 
                      <span class="url">${data.url}</span>: 
                      <strong>${data.title}</strong>`;

    resultsDiv.appendChild(item);
    resultsDiv.scrollTop = resultsDiv.scrollHeight; // Автопрокрутка вниз
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
