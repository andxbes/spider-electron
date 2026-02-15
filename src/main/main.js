const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { URL } = require('node:url');
const cheerio = require('cheerio');

const robotsParser = require('robots-parser');
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
let queue = [];
const MAX_PAGES_TO_VISIT = 50; // Ограничение, чтобы не сканировать вечно
const robotsCache = new Map(); // Кэш для robots.txt по хостам
const referrersMap = new Map(); // Карта обратных ссылок (url -> Set<referrer>)

/**
 * Основная функция сканирования одной страницы
 * @param {string} url - URL для сканирования
 * @param {string} referrer - URL, с которого пришли на эту страницу
 * @param {BrowserWindow} browserWindow - Окно для отправки результатов
 */
async function crawl(url, referrer, browserWindow) {
    if (visitedUrls.size >= MAX_PAGES_TO_VISIT || visitedUrls.has(url)) {
        return;
    }

    console.log(`Сканирую: ${url}`);
    visitedUrls.add(url);

    // --- Проверка robots.txt ---
    const urlObject = new URL(url);
    const robotsUrl = `${urlObject.protocol}//${urlObject.host}/robots.txt`;
    let robots = robotsCache.get(urlObject.host);
    if (!robots) {
        try {
            const robotsResponse = await fetch(robotsUrl);
            const robotsTxt = await robotsResponse.text();
            robots = robotsParser(robotsUrl, robotsTxt);
            robotsCache.set(urlObject.host, robots);
        } catch (e) {
            robots = robotsParser(robotsUrl, ''); // Если robots.txt нет, считаем, что все разрешено
            robotsCache.set(urlObject.host, robots);
        }
    }

    if (!robots.isAllowed(url, 'MyElectronSpider/1.0')) {
        console.log(`Заблокировано robots.txt: ${url}`);
        const referrers = referrersMap.has(url) ? Array.from(referrersMap.get(url)) : (referrer !== 'N/A' ? [referrer] : []);
        browserWindow.webContents.send('spider-result', {
            status: 'SKIPPED',
            url: url,
            title: 'Заблокировано robots.txt',
            referrers: referrers,
            linkCount: 0,
            headings: []
        });
        return;
    }

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

        // 1. Извлекаем данные
        const title = $('title').text().trim();
        const description = $('meta[name="description"]').attr('content') || '';
        const canonical = $('link[rel="canonical"]').attr('href') || '';
        const linkCount = $('a').length;
        const headings = [];
        $('h1, h2, h3, h4, h5, h6').each((i, el) => {
            headings.push({
                level: parseInt(el.tagName.substring(1)),
                text: $(el).text().trim()
            });
        });

        const referrers = referrersMap.has(url) ? Array.from(referrersMap.get(url)) : (referrer !== 'N/A' ? [referrer] : []);

        browserWindow.webContents.send('spider-result', {
            status: response.status,
            url: url,
            title: title || 'Без заголовка',
            referrers: referrers,
            metaDescription: description,
            metaCanonical: canonical,
            linkCount: linkCount,
            headings: headings
        });

        // 2. Проверяем meta-robots на 'nofollow'
        const metaRobots = $('meta[name="robots"]').attr('content') || '';
        if (metaRobots.includes('nofollow')) {
            console.log(`Найден nofollow на странице: ${url}`);
            return; // Не ищем новые ссылки
        }

        // 3. Ищем новые ссылки для обхода
        $('a').each((i, link) => {
            const href = $(link).attr('href');
            if (href) {
                try {
                    const absoluteUrl = new URL(href, url).href.split('#')[0]; // Убираем якоря

                    if (!referrersMap.has(absoluteUrl)) {
                        referrersMap.set(absoluteUrl, new Set());
                    }
                    referrersMap.get(absoluteUrl).add(url);

                    // Добавляем в очередь, если еще не посещали и не в очереди
                    if (!visitedUrls.has(absoluteUrl) && !queue.some(item => item.url === absoluteUrl)) {
                        // Простое правило: остаемся на том же домене
                        if (new URL(absoluteUrl).hostname === new URL(url).hostname) {
                            queue.push({ url: absoluteUrl, referrer: url });
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
            referrers: [referrer],
            linkCount: 0,
            headings: []
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
    queue = [];
    referrersMap.clear();

    queue.push({ url: startUrl, referrer: 'N/A' });

    // Рекурсивная функция для неблокирующего обхода
    const processQueue = async () => {
        if (queue.length === 0 || visitedUrls.size >= MAX_PAGES_TO_VISIT) {
            sendProgress();
            console.log('Сканирование завершено.');

            // Отправляем финальный список рефереров для обновления UI
            const allReferrers = {};
            for (const [link, refs] of referrersMap.entries()) {
                allReferrers[link] = Array.from(refs);
            }
            browserWindow.webContents.send('spider-referrers-update', allReferrers);

            browserWindow.webContents.send('spider-end', 'Сканирование завершено!');
            return;
        }

        const currentItem = queue.shift(); // Берем первый URL из очереди
        if (currentItem) {
            await crawl(currentItem.url, currentItem.referrer, browserWindow);
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
