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

const USER_AGENT = 'MyElectronSpider/1.0 (+https://github.com/your-repo)';
const FETCH_TIMEOUT_MS = 5000;
const FALLBACK_SITEMAP_PATHS = ['/sitemap_index.xml', '/sitemap.xml', '/index.xml'];

const visitedUrls = new Set();
let queue = [];
let maxPagesToVisit = 0; // 0 = без лимита
const robotsCache = new Map(); // host -> { parser, text }
const referrersMap = new Map();

function isPageLimitReached() {
    return maxPagesToVisit > 0 && visitedUrls.size >= maxPagesToVisit;
}

function fetchPage(url) {
    return fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT },
    });
}

function normalizePageUrl(url) {
    return new URL(url).href.split('#')[0];
}

function isSameHost(url, hostname) {
    return new URL(url).hostname === hostname;
}

function parseSitemapsFromRobotsTxt(text) {
    const sitemaps = [];
    for (const line of text.split('\n')) {
        const match = line.match(/^\s*Sitemap:\s*(\S+)/i);
        if (match) {
            sitemaps.push(match[1].trim());
        }
    }
    return sitemaps;
}

async function getRobots(urlObject) {
    const host = urlObject.host;
    if (robotsCache.has(host)) {
        return robotsCache.get(host);
    }

    const robotsUrl = `${urlObject.protocol}//${urlObject.host}/robots.txt`;
    let text = '';
    try {
        const response = await fetchPage(robotsUrl);
        if (response.ok) {
            text = await response.text();
        }
    } catch (e) {
        // robots.txt отсутствует — считаем всё разрешённым
    }

    const entry = {
        parser: robotsParser(robotsUrl, text),
        text,
    };
    robotsCache.set(host, entry);
    return entry;
}

function enqueueUrl(url, referrer, allowedHostname) {
    try {
        const absoluteUrl = normalizePageUrl(url);
        if (!isSameHost(absoluteUrl, allowedHostname)) {
            return;
        }

        if (!referrersMap.has(absoluteUrl)) {
            referrersMap.set(absoluteUrl, new Set());
        }
        if (referrer !== 'N/A') {
            referrersMap.get(absoluteUrl).add(referrer);
        }

        if (!visitedUrls.has(absoluteUrl) && !queue.some((item) => item.url === absoluteUrl)) {
            queue.push({ url: absoluteUrl, referrer });
        }
    } catch (e) {
        // невалидный URL
    }
}

async function fetchSitemapPageUrls(sitemapUrl, allowedHostname, fetchedSitemaps) {
    if (fetchedSitemaps.has(sitemapUrl)) {
        return [];
    }
    fetchedSitemaps.add(sitemapUrl);

    try {
        const response = await fetchPage(sitemapUrl);
        if (!response.ok) {
            console.log(`Sitemap недоступен (${response.status}): ${sitemapUrl}`);
            return [];
        }

        const xml = await response.text();
        const $ = cheerio.load(xml, { xmlMode: true });
        const pageUrls = [];
        const isSitemapIndex = $('sitemapindex').length > 0 || /<sitemapindex[\s>]/i.test(xml);

        if (isSitemapIndex) {
            const nestedSitemaps = [];
            $('sitemap loc, sitemap > loc').each((_, el) => {
                const loc = $(el).text().trim();
                if (loc) {
                    nestedSitemaps.push(loc);
                }
            });

            for (const nestedUrl of nestedSitemaps) {
                const nestedPages = await fetchSitemapPageUrls(nestedUrl, allowedHostname, fetchedSitemaps);
                pageUrls.push(...nestedPages);
            }
            return pageUrls;
        }

        const collectPageUrl = (loc) => {
            if (!loc) {
                return;
            }
            try {
                const absoluteUrl = normalizePageUrl(loc);
                if (isSameHost(absoluteUrl, allowedHostname)) {
                    pageUrls.push(absoluteUrl);
                }
            } catch (e) {
                // пропускаем невалидные URL
            }
        };

        $('url loc, url > loc').each((_, el) => collectPageUrl($(el).text().trim()));

        if (pageUrls.length === 0) {
            $('loc').each((_, el) => collectPageUrl($(el).text().trim()));
        }

        return pageUrls;
    } catch (error) {
        console.error(`Ошибка чтения sitemap ${sitemapUrl}: ${error.message}`);
        return [];
    }
}

async function discoverSitemapUrls(startUrl) {
    const start = new URL(startUrl);
    const origin = `${start.protocol}//${start.host}`;
    const { text } = await getRobots(start);

    const sitemapUrls = parseSitemapsFromRobotsTxt(text);
    if (sitemapUrls.length === 0) {
        for (const path of FALLBACK_SITEMAP_PATHS) {
            sitemapUrls.push(new URL(path, origin).href);
        }
    }

    return [...new Set(sitemapUrls)];
}

async function seedQueueFromSitemaps(startUrl, browserWindow) {
    const start = new URL(startUrl);
    const sitemapUrls = await discoverSitemapUrls(startUrl);
    const fetchedSitemaps = new Set();
    const pageUrls = new Set();

    browserWindow.webContents.send('spider-progress', {
        scanned: 0,
        queue: 0,
        status: `Поиск sitemap (${sitemapUrls.length})...`,
    });

    for (const sitemapUrl of sitemapUrls) {
        const urls = await fetchSitemapPageUrls(sitemapUrl, start.hostname, fetchedSitemaps);
        for (const pageUrl of urls) {
            pageUrls.add(pageUrl);
            enqueueUrl(pageUrl, sitemapUrl, start.hostname);
        }
    }

    console.log(`Из sitemap найдено страниц: ${pageUrls.size}`);
    return pageUrls.size;
}

/**
 * Основная функция сканирования одной страницы
 * @param {string} url - URL для сканирования
 * @param {string} referrer - URL, с которого пришли на эту страницу
 * @param {BrowserWindow} browserWindow - Окно для отправки результатов
 */
async function crawl(url, referrer, browserWindow) {
    if (isPageLimitReached() || visitedUrls.has(url)) {
        return;
    }

    console.log(`Сканирую: ${url}`);
    visitedUrls.add(url);

    const urlObject = new URL(url);
    const { parser: robots } = await getRobots(urlObject);

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
        const response = await fetchPage(url);

        const referrers = referrersMap.has(url) ? Array.from(referrersMap.get(url)) : (referrer !== 'N/A' ? [referrer] : []);

        // 1. Обработка редиректов
        // Если статус 3xx, или fetch перешел сам (redirected), или URL изменился (response.url !== url)
        // При автоматическом переходе fetch возвращает 200, поэтому оригинальный код (301/302) теряется.
        if ((response.status >= 300 && response.status < 400) || response.redirected || (response.url && response.url !== url)) {
            let redirectUrl = null;
            let status = response.status;

            if (response.status >= 300 && response.status < 400) {
                const locationHeader = response.headers.get('location');
                redirectUrl = locationHeader ? new URL(locationHeader, url).href : null;
            } else {
                // Если статус 200, но мы определили редирект (по флагу или URL), ставим 302
                redirectUrl = response.url;
                status = 302; // Условный код, так как оригинал потерян
            }

            browserWindow.webContents.send('spider-result', {
                status: status,
                url: url,
                title: `Редирект на ${redirectUrl || 'неизвестно'}`,
                referrers: referrers,
                metaDescription: '',
                metaCanonical: '',
                linkCount: 0,
                headings: [],
                redirectUrl: redirectUrl
            });

            // Добавляем цель редиректа в очередь, если она есть
            if (redirectUrl) {
                if (!referrersMap.has(redirectUrl)) {
                    referrersMap.set(redirectUrl, new Set());
                }
                referrersMap.get(redirectUrl).add(url);

                if (!visitedUrls.has(redirectUrl) && !queue.some(item => item.url === redirectUrl)) {
                    // Проверяем, остаемся ли мы в пределах домена (или разрешаем редирект на поддомен/www)
                    try {
                        // Для редиректов можно использовать ту же логику или чуть мягче. Используем текущую.
                        if (new URL(redirectUrl).hostname === new URL(url).hostname) {
                            queue.push({ url: redirectUrl, referrer: url });
                        }
                    } catch (e) { }
                }
            }
            return;
        }

        // 2. Обработка ошибок клиента/сервера (4xx, 5xx)
        if (!response.ok) {
            // Вместо выброса ошибки отправляем результат с кодом статуса
            throw new Error(`HTTP ошибка ${response.status}`);
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

        $('a').each((i, link) => {
            const href = $(link).attr('href');
            if (href) {
                enqueueUrl(new URL(href, url).href, url, urlObject.hostname);
            }
        });
    } catch (error) {
        console.error(`Ошибка при сканировании ${url}: ${error.message}`);
        browserWindow.webContents.send('spider-result', {
            status: 'ERROR',
            url: url,
            title: error.message || 'Ошибка',
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
async function startSpider(startUrl, options, browserWindow) {
    const useSitemap = options?.useSitemap ?? false;
    maxPagesToVisit = Math.max(0, parseInt(options?.maxPages, 10) || 0);

    const sendProgress = (status) => {
        browserWindow.webContents.send('spider-progress', {
            scanned: visitedUrls.size,
            queue: queue.length,
            status,
        });
    };

    visitedUrls.clear();
    queue = [];
    referrersMap.clear();
    robotsCache.clear();

    if (useSitemap) {
        const sitemapPageCount = await seedQueueFromSitemaps(startUrl, browserWindow);
        sendProgress(
            sitemapPageCount > 0
                ? `Из sitemap добавлено в очередь: ${sitemapPageCount}`
                : 'Sitemap не найден, обход по ссылкам'
        );
    }

    enqueueUrl(startUrl, 'N/A', new URL(startUrl).hostname);

    // Рекурсивная функция для неблокирующего обхода
    const processQueue = async () => {
        if (queue.length === 0 || isPageLimitReached()) {
            sendProgress();
            console.log('Сканирование завершено.');

            const allReferrers = {};
            for (const [link, refs] of referrersMap.entries()) {
                allReferrers[link] = Array.from(refs);
            }
            browserWindow.webContents.send('spider-referrers-update', allReferrers);

            let endMessage = 'Сканирование завершено!';
            if (isPageLimitReached() && queue.length > 0) {
                endMessage = `Достигнут лимит ${maxPagesToVisit} стр. В очереди осталось: ${queue.length}`;
            }

            browserWindow.webContents.send('spider-end', endMessage);
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

ipcMain.on('start-spider', (event, payload) => {
    const startUrl = typeof payload === 'string' ? payload : payload.startUrl;
    const options = typeof payload === 'string' ? {} : (payload.options || {});
    console.log(`Получен запрос на сканирование, начиная с: ${startUrl}`, options);
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (browserWindow) {
        startSpider(startUrl, options, browserWindow).catch(err => {
            console.error('Критическая ошибка в startSpider:', err);
            browserWindow.webContents.send('spider-end', `Ошибка: ${err.message}`);
        });
    }
});
