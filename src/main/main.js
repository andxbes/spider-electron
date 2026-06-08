const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { URL } = require('node:url');
const cheerio = require('cheerio');

const robotsParser = require('robots-parser');
const { getSettingsPath, loadSettings, saveSettings, MAX_CONCURRENCY } = require('./settings-persistence');

// Функція створення головного вікна застосунку
const createWindow = () => {
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            // Шлях до preload-скрипта для безпечної взаємодії з renderer
            preload: path.join(__dirname, '../preload/preload.js'),
        },
    });

    // Завантажуємо основний HTML-файл
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Розкоментуйте для відкриття інструментів розробника при старті
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


// --- ЛОГІКА ВЕБ-ПАВУКА ---

const USER_AGENT = 'MyElectronSpider/1.0 (+https://github.com/your-repo)';
const FETCH_TIMEOUT_MS = 5000;
const FALLBACK_SITEMAP_PATHS = ['/sitemap_index.xml', '/sitemap.xml', '/index.xml'];

const visitedUrls = new Set();
let queue = [];
let maxPagesToVisit = 0; // 0 = без ліміту
const robotsCache = new Map(); // host -> { parser, text }
const referrersMap = new Map();

function isPageLimitReached() {
    return maxPagesToVisit > 0 && visitedUrls.size >= maxPagesToVisit;
}

function tryClaimUrl(url) {
    if (visitedUrls.has(url)) {
        return false;
    }
    if (isPageLimitReached()) {
        return false;
    }
    visitedUrls.add(url);
    return true;
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
        // robots.txt відсутній — вважаємо все дозволеним
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
        // невалідний URL
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
            console.log(`Sitemap недоступний (${response.status}): ${sitemapUrl}`);
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
                // пропускаємо невалідні URL
            }
        };

        $('url loc, url > loc').each((_, el) => collectPageUrl($(el).text().trim()));

        if (pageUrls.length === 0) {
            $('loc').each((_, el) => collectPageUrl($(el).text().trim()));
        }

        return pageUrls;
    } catch (error) {
        console.error(`Помилка читання sitemap ${sitemapUrl}: ${error.message}`);
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
        status: `Пошук sitemap (${sitemapUrls.length})...`,
    });

    for (const sitemapUrl of sitemapUrls) {
        const urls = await fetchSitemapPageUrls(sitemapUrl, start.hostname, fetchedSitemaps);
        for (const pageUrl of urls) {
            pageUrls.add(pageUrl);
            enqueueUrl(pageUrl, sitemapUrl, start.hostname);
        }
    }

    console.log(`У sitemap знайдено сторінок: ${pageUrls.size}`);
    return pageUrls.size;
}

/**
 * Основна функція сканування однієї сторінки
 * @param {string} url - URL для сканування
 * @param {string} referrer - URL, з якого перейшли на цю сторінку
 * @param {BrowserWindow} browserWindow - Вікно для надсилання результатів
 */
async function crawl(url, referrer, browserWindow) {
    if (!tryClaimUrl(url)) {
        return;
    }

    console.log(`Сканую: ${url}`);

    const urlObject = new URL(url);
    const { parser: robots } = await getRobots(urlObject);

    if (!robots.isAllowed(url, 'MyElectronSpider/1.0')) {
        console.log(`Заблоковано robots.txt: ${url}`);
        const referrers = referrersMap.has(url) ? Array.from(referrersMap.get(url)) : (referrer !== 'N/A' ? [referrer] : []);
        browserWindow.webContents.send('spider-result', {
            status: 'SKIPPED',
            url: url,
            title: 'Заблоковано robots.txt',
            referrers: referrers,
            linkCount: 0,
            outlinks: [],
            headings: []
        });
        return;
    }

    try {
        const response = await fetchPage(url);

        const referrers = referrersMap.has(url) ? Array.from(referrersMap.get(url)) : (referrer !== 'N/A' ? [referrer] : []);

        // 1. Обробка редиректів
        // Якщо статус 3xx, або fetch сам перейшов (redirected), або URL змінився (response.url !== url)
        // При автоматичному переході fetch повертає 200, тому оригінальний код (301/302) втрачається.
        if ((response.status >= 300 && response.status < 400) || response.redirected || (response.url && response.url !== url)) {
            let redirectUrl = null;
            let status = response.status;

            if (response.status >= 300 && response.status < 400) {
                const locationHeader = response.headers.get('location');
                redirectUrl = locationHeader ? new URL(locationHeader, url).href : null;
            } else {
                // Якщо статус 200, але редирект визначено за прапорцем або URL — ставимо 302
                redirectUrl = response.url;
                status = 302; // Умовний код, оскільки оригінал втрачено
            }

            browserWindow.webContents.send('spider-result', {
                status: status,
                url: url,
                title: `Редирект на ${redirectUrl || 'невідомо'}`,
                referrers: referrers,
                metaDescription: '',
                metaCanonical: '',
                linkCount: 0,
                outlinks: [],
                headings: [],
                redirectUrl: redirectUrl
            });

            // Додаємо ціль редиректу в чергу, якщо вона є
            if (redirectUrl) {
                if (!referrersMap.has(redirectUrl)) {
                    referrersMap.set(redirectUrl, new Set());
                }
                referrersMap.get(redirectUrl).add(url);

                if (!visitedUrls.has(redirectUrl) && !queue.some(item => item.url === redirectUrl)) {
                    try {
                        if (new URL(redirectUrl).hostname === new URL(url).hostname) {
                            queue.push({ url: redirectUrl, referrer: url });
                        }
                    } catch (e) { }
                }
            }
            return;
        }

        // 2. Обробка помилок клієнта/сервера (4xx, 5xx)
        if (!response.ok) {
            throw new Error(`HTTP помилка ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const title = $('title').text().trim();
        const description = $('meta[name="description"]').attr('content') || '';
        const canonical = $('link[rel="canonical"]').attr('href') || '';
        const outlinks = [];
        $('a').each((i, link) => {
            const href = $(link).attr('href');
            if (!href) {
                return;
            }
            try {
                const absoluteUrl = normalizePageUrl(new URL(href, url).href);
                outlinks.push({
                    href: absoluteUrl,
                    text: $(link).text().trim().slice(0, 200),
                });
            } catch (e) {
                // невалідний href
            }
        });

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
            linkCount: outlinks.length,
            outlinks: outlinks,
            headings: headings
        });

        const metaRobots = $('meta[name="robots"]').attr('content') || '';
        if (metaRobots.includes('nofollow')) {
            console.log(`Знайдено nofollow на сторінці: ${url}`);
            return;
        }

        for (const outlink of outlinks) {
            enqueueUrl(outlink.href, url, urlObject.hostname);
        }
    } catch (error) {
        console.error(`Помилка під час сканування ${url}: ${error.message}`);
        browserWindow.webContents.send('spider-result', {
            status: 'ERROR',
            url: url,
            title: error.message || 'Помилка',
            referrers: [referrer],
            linkCount: 0,
            outlinks: [],
            headings: []
        });
    }
}

/**
 * Запускає процес сканування
 * @param {string} startUrl - Початковий URL
 * @param {BrowserWindow} browserWindow - Вікно для надсилання результатів
 */
function finishScan(browserWindow, sendProgress) {
    sendProgress();
    console.log('Сканування завершено.');

    const allReferrers = {};
    for (const [link, refs] of referrersMap.entries()) {
        allReferrers[link] = Array.from(refs);
    }
    browserWindow.webContents.send('spider-referrers-update', allReferrers);

    let endMessage = 'Сканування завершено!';
    if (isPageLimitReached() && queue.length > 0) {
        endMessage = `Досягнуто ліміт ${maxPagesToVisit} стор. У черзі залишилось: ${queue.length}`;
    }

    browserWindow.webContents.send('spider-end', endMessage);
}

async function startSpider(startUrl, options, browserWindow) {
    const useSitemap = options?.useSitemap ?? false;
    maxPagesToVisit = Math.max(0, parseInt(options?.maxPages, 10) || 0);
    const concurrency = Math.min(
        MAX_CONCURRENCY,
        Math.max(1, parseInt(options?.concurrency, 10) || 1)
    );

    let activeWorkers = 0;
    let scanFinished = false;

    const sendProgress = (status) => {
        browserWindow.webContents.send('spider-progress', {
            scanned: visitedUrls.size,
            queue: queue.length,
            active: activeWorkers,
            status,
        });
    };

    const tryFinishOrPump = () => {
        if (scanFinished) {
            return;
        }

        const limitReached = isPageLimitReached();
        const canStartMore = !limitReached && queue.length > 0 && activeWorkers < concurrency;

        if (canStartMore) {
            pumpQueue();
            return;
        }

        if (activeWorkers === 0 && (queue.length === 0 || limitReached)) {
            scanFinished = true;
            finishScan(browserWindow, sendProgress);
        }
    };

    const pumpQueue = () => {
        while (
            !scanFinished &&
            activeWorkers < concurrency &&
            queue.length > 0 &&
            !isPageLimitReached()
        ) {
            const item = queue.shift();
            if (!item) {
                break;
            }

            activeWorkers++;
            crawl(item.url, item.referrer, browserWindow)
                .catch((err) => {
                    console.error(`Помилка воркера для ${item.url}:`, err);
                })
                .finally(() => {
                    activeWorkers--;
                    sendProgress();
                    tryFinishOrPump();
                });
        }

        tryFinishOrPump();
    };

    visitedUrls.clear();
    queue = [];
    referrersMap.clear();
    robotsCache.clear();

    if (useSitemap) {
        const sitemapPageCount = await seedQueueFromSitemaps(startUrl, browserWindow);
        sendProgress(
            sitemapPageCount > 0
                ? `З sitemap додано в чергу: ${sitemapPageCount}`
                : 'Sitemap не знайдено, обхід за посиланнями'
        );
    }

    enqueueUrl(startUrl, 'N/A', new URL(startUrl).hostname);
    pumpQueue();
}

ipcMain.handle('settings:get', async () => {
    const settings = await loadSettings();
    return { settings, filePath: getSettingsPath() };
});

ipcMain.handle('settings:save', async (_event, settings) => {
    const saved = await saveSettings(settings);
    return { settings: saved, filePath: getSettingsPath() };
});

ipcMain.on('start-spider', (event, payload) => {
    const startUrl = typeof payload === 'string' ? payload : payload.startUrl;
    const options = typeof payload === 'string' ? {} : (payload.options || {});
    console.log(`Отримано запит на сканування, починаючи з: ${startUrl}`, options);
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (browserWindow) {
        startSpider(startUrl, options, browserWindow).catch(err => {
            console.error('Критична помилка в startSpider:', err);
            browserWindow.webContents.send('spider-end', `Помилка: ${err.message}`);
        });
    }
});
