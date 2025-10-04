const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { URL } = require('node:url');
const cheerio = require('cheerio');

// Функция для создания главного окна приложения
const createWindow = () => {
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            // Указываем путь к preload-скрипту для безопасного взаимодействия
            preload: path.join(__dirname, '../preload/preload.js'),
        },
    });

    // Загружаем основной HTML-файл
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Раскомментируйте для открытия инструментов разработчика при старте
    // mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});


// --- ЛОГИКА ВЕБ-ПАУКА ---

// Хранилища для URL
const visitedUrls = new Set();
const queue = [];
const MAX_PAGES_TO_VISIT = 50; // Ограничение, чтобы не сканировать вечно

/**
 * Основная функция сканирования одной страницы
 * @param {string} url - URL для сканирования
 * @param {BrowserWindow} browserWindow - Окно для отправки результатов
 */
async function crawl(url, browserWindow) {
    if (visitedUrls.size >= MAX_PAGES_TO_VISIT || visitedUrls.has(url)) {
        return;
    }

    console.log(`Сканирую: ${url}`);
    visitedUrls.add(url);

    try {
        // Используем fetch вместо axios
        const response = await fetch(url, {
            signal: AbortSignal.timeout(5000), // Аналог timeout в axios
            headers: {
                'User-Agent': 'MyElectronSpider/1.0 (+https://github.com/your-repo)',
            },
        });

        // fetch не выбрасывает ошибку на 4xx/5xx статусы, проверяем вручную
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text(); // Получаем HTML как текст
        const $ = cheerio.load(html);

        // 1. Извлекаем данные (например, заголовок страницы)
        const title = $('title').text().trim();
        browserWindow.webContents.send('spider-result', {
            status: response.status,
            url: url,
            title: title || 'Без заголовка',
        });

        // 2. Ищем новые ссылки для обхода
        $('a').each((i, link) => {
            const href = $(link).attr('href');
            if (href) {
                try {
                    const absoluteUrl = new URL(href, url).href.split('#')[0]; // Убираем якоря
                    // Добавляем в очередь, если еще не посещали и не в очереди
                    if (!visitedUrls.has(absoluteUrl) && !queue.includes(absoluteUrl)) {
                        // Простое правило: остаемся на том же домене
                        if (new URL(absoluteUrl).hostname === new URL(url).hostname) {
                            queue.push(absoluteUrl);
                        }
                    }
                } catch (e) {
                    // Игнорируем невалидные URL, например 'javascript:void(0)'
                }
            }
        });
    } catch (error) {
        console.error(`Ошибка при сканировании ${url}: ${error.message}`);
        browserWindow.webContents.send('spider-result', {
            status: 'ERROR',
            url: url,
            title: error.message,
        });
    }
}

/**
 * Запускает процесс сканирования
 * @param {string} startUrl - Начальный URL
 * @param {BrowserWindow} browserWindow - Окно для отправки результатов
 */
async function startSpider(startUrl, browserWindow) {
    // Функция для отправки прогресса в рендерер
    const sendProgress = () => {
        browserWindow.webContents.send('spider-progress', {
            scanned: visitedUrls.size,
            queue: queue.length,
        });
    };
    // Очищаем перед новым запуском
    visitedUrls.clear();
    queue.length = 0; // Эффективная очистка массива

    queue.push(startUrl);

    // Рекурсивная функция для неблокирующего обхода
    const processQueue = async () => {
        if (queue.length === 0 || visitedUrls.size >= MAX_PAGES_TO_VISIT) {
            sendProgress();
            console.log('Сканирование завершено.');
            browserWindow.webContents.send('spider-end', 'Сканирование завершено!');
            return;
        }

        const currentUrl = queue.shift(); // Берем первый URL из очереди
        if (currentUrl) {
            await crawl(currentUrl, browserWindow);
            sendProgress();
        }

        // Даем основному потоку "передышку" перед следующим URL
        setTimeout(processQueue, 0);
    };

    // Запускаем обработку очереди
    await processQueue();
}

// Слушаем событие 'start-spider' от Renderer процесса
ipcMain.on('start-spider', (event, startUrl) => {
    console.log(`Получен запрос на сканирование, начиная с: ${startUrl}`);
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (browserWindow) {
        // Запускаем паука и ловим любые ошибки, которые могут возникнуть при запуске
        startSpider(startUrl, browserWindow).catch(err => {
            console.error('Критическая ошибка в startSpider:', err);
            browserWindow.webContents.send('spider-end', `Ошибка: ${err.message}`);
        });
    }
});
