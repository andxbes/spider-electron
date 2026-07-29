# Spider-Electron — внутрішня документація

> Останнє оновлення: 2026-07-29 (HTTP timeout сторінок 20s)  
> Короткий довідник для розробки та правок. Детальніше про підтримку — [DOC_MAINTENANCE.md](./DOC_MAINTENANCE.md).

## Що це

Desktop-краулер на **Electron**: main process обходить сайт по HTTP і парсить HTML, renderer показує результати та експортує CSV. Логіка краулера та UI-фільтрів винесена в окремі модулі з unit-тестами (`npm test`).

## Структура файлів

```
assets/
├── icon.png               # Іконка застосунку (Linux / dev)
└── icon.ico               # Windows
src/
├── shared/
│   ├── url-utils.js       # URL-утиліти (main + тести)
│   ├── user-agents.js     # Пресети User-Agent (main + renderer)
│   └── hook-registry.js   # Реєстр хуків (waterfall / filter / tap)
├── main/
│   ├── main.js            # Electron lifecycle + IPC
│   ├── app-about.js       # Метадані застосунку (версія, автор)
│   ├── spider-logic.js  # Оркестратор: crawl, startSpider (~620 рядків)
│   ├── crawl-state.js   # Mutable state: visited, queues, session
│   ├── crawl-network.js # Fetch, robots.txt, таймаути, auth-заголовки
│   ├── request-delay.js   # Пауза між HTTP-запитами
│   ├── http-auth.js       # HTTP Basic / Bearer для fetch
│   ├── crawl-results.js # buildSpiderResult, meta robots parsing
│   ├── crawl-referrers.js # referrersMap, add/merge referrers
│   ├── crawl-queue.js   # html/media/probe черги, enqueue/dequeue
│   ├── crawl-sitemap.js # Sitemap discovery і seed черги
│   ├── probe.js         # probeDiscoveredLink, reportDiscoveredLinks
│   ├── link-collector.js # Збір і класифікація outlinks з HTML
│   ├── html-parser.js     # cheerio: поля сторінки + collectPageLinks (sync)
│   ├── html-parse-pool.js # Пул worker_threads для HTML-парсингу
│   ├── html-parse-worker.js # Entry point воркера
│   ├── page-extractors.js # Парсинг title/meta/headings з HTML
│   ├── crawl-hooks.js     # Хуки збору даних + emit до renderer
│   ├── crawl-defaults.js  # Дефолтні crawl-хуки
│   ├── plugins/
│   │   ├── index.js       # Завантаження main-плагінів
│   │   └── og-meta.js     # Open Graph meta
│   ├── settings-persistence.js
│   └── session-dump.js
├── preload/preload.js     # IPC bridge (contextBridge → window.api)
└── renderer/
    ├── index.html         # UI shell, CSP
    ├── ui-logic.js        # Чиста логіка фільтрів, класифікації, CSV-даних
    ├── ui-hooks.js        # Реєстр UI-хуків (transform, columns, export)
    ├── ui-defaults.js     # Дефолтні колонки таблиці / деталі / CSV
    ├── plugins/
    │   └── og-meta.js     # Open Graph UI
    ├── scan-store.js      # In-memory сховище результатів + referrers
    ├── table-filters.js   # Стан фільтрів, DOM-синхронізація, getDisplayedResults
    ├── table-view.js      # Таблиця: lazy render, thead, resize, refresh
    ├── detail-panel.js    # Панель деталей (хуки рядків)
    ├── workspace-controller.js # sessionStorage, restore, populate results
    ├── scan-handlers.js   # IPC spider-result/end/progress, upsert, finalize
    ├── export-csv.js      # Експорт через ui:exportColumns
    ├── renderer.js        # Оркестрація: кнопки, старт скану, з'єднує модулі (~680 рядків)
    ├── session-dump.js    # Дамп / workspace у sessionStorage
    ├── settings-store.js
    ├── settings.js
    ├── input.css          # Tailwind source
    └── styles.css         # згенерований CSS (gitignored)
tests/
├── shared/hook-registry.test.js
├── shared/url-utils.test.js
├── main/html-parser.test.js
├── main/html-parse-pool.test.js
├── main/spider-logic.test.js
├── main/crawl-hooks.test.js
├── main/plugins/og-meta.test.js
├── main/settings-persistence.test.js
├── main/session-dump.test.js
├── renderer/ui-logic.test.js
├── renderer/ui-hooks.test.js
├── renderer/session-dump.test.js
├── renderer/settings-store.test.js
├── renderer/renderer-scope.test.js
└── preload/ipc-channels.test.js
```

| Файл | Відповідальність |
|------|------------------|
| `main.js` | Electron lifecycle, IPC handlers |
| `spider-logic.js` | Оркестратор: `crawl`, `startSpider`, re-export для тестів |
| `crawl-state.js` | `visitedUrls`, черги, `scanSession`, `tryClaimUrl` |
| `crawl-network.js` | `fetchPage`, `getRobots`, auth-контекст скану (`setScanAuthContext`) |
| `http-auth.js` | `getAuthHeadersForUrl` — Basic/Bearer лише для hostname скану |
| `crawl-results.js` | `buildSpiderResult`, `parseMetaRobotsDirective`, indexing |
| `crawl-referrers.js` | `referrersMap`, `addReferrer`, `getReferrersSnapshot` |
| `crawl-queue.js` | `enqueueUrl`, `dequeueNextUrl`, `hasPendingWork`, FIFO crawl queue |
| `crawl-sitemap.js` | `discoverSitemapUrls`, `seedQueueFromSitemaps` |
| `probe.js` | HTTP-probe зовнішніх/медіа посилань, stub batch |
| `link-collector.js` | `collectPageLinks`, класифікація outlinks, `isCrawlableLink` |
| `html-parser.js` | `parseHtmlDocument` — cheerio + дефолтні extractors + OG + links |
| `html-parse-pool.js` | Пул `worker_threads` (розмір ≈ `min(8, CPU-1)`); `parseHtmlDocumentAsync` |
| `page-extractors.js` | Витяг title, meta, headings, meta robots з cheerio |
| `crawl-hooks.js` | Точки розширення збору; `emitSpiderResult` перед IPC |
| `hook-registry.js` | Універсальний реєстр хуків (main + renderer) |
| `preload.js` | Whitelist каналів IPC, `window.api` |
| `ui-logic.js` | Фільтри, класифікація ресурсів, rel/meta, дублікати, сортування (`compareRowsImpl` — ключі як у `sortKey` колонок) |
| `scan-store.js` | `Map` результатів, referrers, upsert з `ui:transformResult`; при повторному upsert збережені HTML-поля (title, meta, headings, OG) не затираються порожніми значеннями |
| `ui-hooks.js` / `ui-defaults.js` | Колонки таблиці, рядки деталей, CSV — через хуки |
| `table-filters.js` | Стан фільтрів таблиці, `getDisplayedResults`, прив'язка до DOM |
| `table-view.js` | Lazy-render таблиці, thead/resize, інкрементальний refresh |
| `detail-panel.js` | Вкладки деталей / inlinks / outlinks через `ui:detailRows` |
| `workspace-controller.js` | Persist/restore workspace у sessionStorage, populate/clear results |
| `scan-handlers.js` | `onSpiderResult/Batch/End/Progress`, upsert, finalize scan UI |
| `renderer.js` | Кнопки скану, дамп, detail resize — з'єднує модулі |

## Система хуків

Розширення без правок ядра — через `createHookRegistry()` (`src/shared/hook-registry.js`).

### Crawl (main)

Реєстр: `crawlHookRegistry` у `crawl-hooks.js`. Дефолти — `crawl-defaults.js`.

| Хук | Коли | Приклад розширення |
|-----|------|-------------------|
| `crawl:extractPage` | Після парсингу HTML | Додати Open Graph, schema.org, custom meta |
| `crawl:buildResult` | Перед відправкою `spider-result` | Додати поля в модель |
| `crawl:beforeEmitResult` | Останній фільтр IPC | Повернути `false` — не слати результат |
| `crawl:filterDiscoveredLink` | Знайдені посилання | Відкинути трекери, mailto тощо |
| `crawl:transformBatch` | `spider-results-batch` | Змінити stub-масив |

```js
const { CRAWL_HOOKS, crawlHookRegistry } = require('./crawl-hooks');

crawlHookRegistry.register(CRAWL_HOOKS.EXTRACT_PAGE, (ctx, fields) => ({
    ...fields,
    ogImage: ctx.$('meta[property="og:image"]').attr('content') || '',
}), { priority: 20 });
```

Усі `spider-result` проходять через `emitSpiderResult()` — не слати напряму з `webContents.send`.

### UI (renderer)

Реєстр: `uiHookRegistry` у `ui-hooks.js`. Дефолтні колонки/деталі/CSV — `ui-defaults.js`.

| Хук | Коли | Приклад |
|-----|------|---------|
| `ui:transformResult` | `upsert` у `scan-store` | Нормалізувати / збагачити рядок |
| `ui:tableColumns` | Рендер таблиці | Додати колонку (priority > 0) |
| `ui:detailRows` | Вкладка «Деталі» | Додати поля в панель |
| `ui:exportColumns` | CSV export | Нова колонка в експорті |

```js
uiHookRegistry.register(UI_HOOKS.TABLE_COLUMNS, (ctx, cols) => [
    ...cols,
    { id: 'ogImage', sortKey: 'ogImage', thLabel: 'OG Image', renderCell: (data) => `...` },
], { priority: 50 });
```

`table-view.js` і `export-csv.js` читають колонки через `resolveTableColumns` / `resolveExportColumns`.

## Плагіни

Розширення оформлюються окремими файлами; кожен плагін реєструє хуки при завантаженні.

| Плагін | Main | Renderer |
|--------|------|----------|
| `og-meta` | `src/main/plugins/og-meta.js` | `src/renderer/plugins/og-meta.js` |
| `redirect-chain` | `src/shared/redirect-chain.js` + `src/main/plugins/redirect-chain.js` | `src/renderer/plugins/redirect-chain.js` |

**Підключення main:** `src/main/plugins/index.js` → `require('./plugins')` у `spider-logic.js` (після `crawl-defaults`).

**Підключення renderer:** `<script src="../shared/redirect-chain.js">`, плагіни в `index.html` (після `ui-defaults.js`).

**og-meta** збирає `og:title`, `og:description`, `og:image` через `crawl:extractPage`; додаткові поля з extractors потрапляють у `spider-result` через spread `pluginPageFields` у `crawl()`. UI: колонки «OG Title» / «OG Image», рядки в деталях, колонки CSV.

**redirect-chain** (`src/shared/redirect-chain.js`): відстеження ланцюгів редиректів під час `crawl` / `probe`, ліміт **20** переходів (`MAX_REDIRECT_HOPS`), виявлення циклів (перше повторення URL). Метадані на **початковому** URL: `redirectHopCount`, `redirectFinalUrl`, `redirectChain`, `redirectInfinite`, `redirectLoopStartUrl`. Проміжні URL (`redirectHopOnly` / серединa `redirectChain`) **приховані** в основній таблиці; стартовий і кінцевий URL залишаються. UI: колонка «Редирект» (жовтий — 2+ переходи, червоний — цикл/∞), деталі з кінцевим URL і ланцюгом, колонки CSV.

Новий плагін:
1. `src/main/plugins/my-plugin.js` + рядок у `plugins/index.js`
2. За потреби `src/renderer/plugins/my-plugin.js` + script у `index.html`
3. Unit-тест у `tests/main/plugins/` або `tests/renderer/plugins/`

## Архітектура (Electron)

```
Renderer (renderer.js)
    ↓ window.api.startSpider(url)
Preload (preload.js)
    ↓ ipcRenderer.send('start-spider')
Main (main.js)
    ↓ crawl() → fetch (main) + html-parse-pool (worker_threads)
    ↑ webContents.send('spider-*')
Renderer
```

- Мережеві запити — **тільки в main** (правильно для безпеки).
- Renderer не має Node.js; доступ лише через `window.api`.
- `contextIsolation` не заданий явно — діють дефолти Electron (зазвичай `true`).

## Алгоритм краулера

**Тип:** BFS — одна FIFO-черга `crawlQueue` (HTML і медіа в порядку знаходження); окремо `probeQueue` для зовнішніх / не-crawlable посилань.

**Запуск:** `ipcMain.on('start-spider')` → `startSpider()` → `processQueue()` (рекурсія через `setTimeout(..., 0)`).

**Опція sitemap (`useSitemap`):** перед обходом читається `robots.txt`, з нього витягуються рядки `Sitemap:`. Якщо їх немає — пробуються `/sitemap_index.xml`, `/sitemap.xml`, `/index.xml`. Якщо в опціях передано непорожній `sitemapUrls` (масив рядків з UI) — використовуються **лише** ці URL (абсолютні або шляхи від кореня сайту); рядки з robots.txt і типові шляхи **не** беруться. XML парситься (індекс + вкладені sitemap + `urlset`), URL сторінок додаються в чергу **першими** (по мірі читання вкладених файлів, з оновленням `spider-progress`). Вкладені sitemap завантажуються **паралельно** з лімітом `concurrency` (як основний обхід); кожен HTTP-запит sitemap чекає `requestDelayMs` (jitter ±20%). Referrer для таких URL — адреса sitemap-файлу. Зупинка (`spider-stop`) перериває фазу sitemap.

**На кожній сторінці (`crawl`):**

1. Skip, якщо URL вже в `visitedUrls` або ліміт досягнуто.
2. Перевірка **robots.txt** (внутрішні URL) — якщо `Disallow` і увімкнено `respectRobotsTxt` (за замовч.), HTTP-запит **не** виконується: ні `crawl`, ні `probe`; `status: 0`. Якщо `respectRobotsTxt: false` — сторінки скануються, але `robotsAllowed` / `robotsRule` у результаті лишаються. Зовнішні URL перевіряються по HTTP навіть при забороні в robots.txt їхнього хоста.
3. `fetch` з timeout **20s** для сторінок/probe (`FETCH_TIMEOUT_MS`), **60s** для sitemap XML (`SITEMAP_FETCH_TIMEOUT_MS`); `redirect: 'manual'`, User-Agent з налаштувань; пауза `requestDelayMs` (за замовч. 500 мс, jitter ±20%) перед кожним HTTP-запитом (сторінки, probe і sitemap); за наявності — `Authorization` (Basic/Bearer) **лише для URL з hostname скану**.
4. **3xx** — фіксація `redirectUrl`, ланцюг до **20** переходів (`redirect-chain.js`); метадані на стартовому URL; **status** на стартовому URL — код **першого** редиректу (301/302…), не фінальний 200. Те саме для `probe`. При циклі або перевищенні ліміту — `redirectInfinite`. Enqueue цілі (лише той самий `hostname`); ціль redirect теж перевіряється robots.txt перед fetch. Probe **не** перезаписує URL, уже пройдені через `crawl` (`visitedUrls`).
5. **4xx/5xx** — `status` = код відповіді, `title` порожній.
6. **200 HTML** — тіло відповіді парситься в **worker thread** (`html-parse-pool.js`): cheerio → title, meta, headings, OG, `collectPageLinks`. На main лишаються fetch, robots, черга, IPC. Хуки `crawl:extractPage` без `ctx.$` отримують уже зібрані поля (для додаткових полів без DOM).
7. Якщо `<meta name="robots" content="nofollow">` — не додає нові посилання.
8. Збір URL з HTML: `<a>`, `<link>`, `<script>`, `<img>`, … — HTML-сторінки через `crawl`; **медіа, CSS, JS і зовнішні** — stub у batch, потім **probe** (status + `content-type` + robots.txt + `X-Robots-Tag`, без HTML) — навіть при `rel=nofollow`. BFS лише для внутрішніх навігаційних: `a[href]`, `area[href]`, `form[action]`, `iframe[src]` (HTML). Stub для не-навігаційних ресурсів — **завжди**; для навігаційних — лише якщо URL не в черзі обходу. У `spider-result`: **Meta robots** — лише `<meta name="robots">` / `googlebot`; **X-Robots-Tag** — окремо з HTTP-заголовка; **responseHeaders** — усі заголовки відповіді (для UI / дампу).

**Завершення:** порожня черга або досягнуто `maxPages` (якщо > 0) → `spider-referrers-update` → `spider-end`. На renderer після referrers — `materializeDiscoveredFromReferrers()`: URL з referrers, яких немає в `scanResults`, додаються як знайдені (`fetched: false`).

**Зупинка (`spider-stop`):** `stopSpiderSession()` — прапорець `stopped`, негайно `terminateHtmlParsePool()` (скасовує чергу парсингу), нові воркери не стартують. Активні `crawl`/`probe` дочекаються поточного `fetch`, але після стопу **не** парсять HTML, не шлють `spider-result` і не додають посилання в чергу. Коли `activeWorkers === 0` → `spider-end`.

**Пауза (`spider-pause` / кнопка «Зупинити» в UI):** нові воркери не стартують, черга **зберігається**. Воркери, що вже в роботі, **дозавершують** поточну сторінку (редиректи, парсинг, `reportDiscoveredLinks`) — посилання з них лишаються в черзі. `Продовжити` (`spider-resume`) — обхід з тієї ж черги.

## Константи (hardcoded у `main.js`)

| Константа | Значення | Рядок |
|-----------|----------|-------|
| `maxPages` (опція UI) | 0 = без ліміту | renderer → main |
| `concurrency` (опція UI) | 1–50, за замовч. 3 | паралельних `crawl()` / `probe()` |
| HTML parse pool | `min(8, CPU−1)` воркерів | `html-parse-pool.js` (`DEFAULT_POOL_SIZE`) |
| HTTP timeout | **20000 ms** (сторінки/probe); **60000 ms** sitemap | `crawl-network.js` / `crawl-sitemap.js` |
| Пауза між запитами | 500 ms (0–60000, jitter ±20%) | `request-delay.js`, налаштування |
| User-Agent | з налаштувань (`userAgentPreset` / `userAgentCustom`) | `user-agents.js`, `setScanUserAgent` |
| Область обходу | один `hostname` | ~146, ~210 |

Зміни цих параметрів — правити `main.js` і оновити цю таблицю.

## IPC-канали

| Напрямок | Канал | Payload |
|----------|-------|---------|
| R → M | `start-spider` | `{ startUrl, options: { useSitemap?, sitemapUrls?, respectRobotsTxt?, requestDelayMs?, userAgentPreset?, userAgentCustom?, maxPages?, concurrency?, authType?, authUsername?, authPassword?, authToken? } }` |
| R → M | `spider-pause` / `spider-resume` / `spider-stop` | керування скануванням |
| R → M | `shell:open-external` | відкрити URL у браузері |
| R ↔ M | `settings:get` / `settings:save` | налаштування у `userData/settings.json` (див. нижче) |
| R ↔ M | `app:getAbout` | `{ name, version, author, email }` — версія з `package.json` через `app.getVersion()` |
| M → R | `about-show` | відкрити модальне «Про програму» (меню «Про програму») |
| M → R | `spider-result` | один об'єкт посилання (завантажене) |
| M → R | `spider-results-batch` | масив знайдених, не завантажених посилань |
| M → R | `spider-progress` | `{ scanned, queue, active?, status?, finished? }` |
| M → R | `spider-referrers-update` | `{ referrers: { [url]: referrers[] }, robotsByUrl: { [url]: { robotsAllowed, robotsRule } } }` |
| M → R | `spider-end` | `message: string` |

Нові канали — додати в `preload.js` (`validSendChannels` / `validReceiveChannels`) і в `contextBridge`.

## Налаштування (`settings.json`)

Зберігаються в `userData` через `settings-persistence.js`. Поля:

| Поле | Тип | Опис |
|------|-----|------|
| `useSitemap` | boolean | Спочатку sitemap, потім обхід посилань |
| `respectRobotsTxt` | boolean | `true` (за замовч.) — не сканувати URL з Disallow; `false` — сканувати, але показувати правило в UI |
| `userAgentPreset` | string | `spider`, `chrome-win`, `googlebot`, `custom`, … — див. `src/shared/user-agents.js` |
| `userAgentCustom` | string | Власний User-Agent, якщо `userAgentPreset === 'custom'` |
| `requestDelayMs` | number | 0–60000; пауза перед кожним HTTP-запитом на воркер (за замовч. **500**, jitter ±20%). **0** — без паузи |
| `maxPages` | number | 0 = без ліміту |
| `concurrency` | number | 1–50, паралельних `crawl()` |
| `authType` | `'none'` \| `'basic'` \| `'bearer'` | Серверна автентифікація |
| `authUsername` | string | Логін для Basic |
| `authPassword` | string | Пароль для Basic (у файлі як є) |
| `authToken` | string | Bearer-токен |

**Сесійне (не в `settings.json`):** `sitemapUrls` — текст у полі налаштувань (один URL на рядок). Зберігається лише в памʼяті renderer (`settings-store.js`) поки відкрито вікно; при старті скану передається в `start-spider` як масив. Якщо непорожній і `useSitemap` — discovery ігнорує robots.txt / fallback-шляхи. У **дамп сканування** потрапляє як `settings.sitemapUrlsText` разом з усіма збереженими полями спайдера.

При старті скану renderer передає збережені поля (+ сесійні `sitemapUrls`) в `start-spider`; main встановлює auth-контекст для hostname стартового URL. Зовнішні URL (probe) заголовок не отримують.

### Дамп сканування (`.spider.json`)

Файл містить `results`, `insertionOrder`, `startUrl`, прогрес і **`settings`**: усі поля з `settings.json` плюс `sitemapUrlsText`. При завантаженні дампу (`applySessionDump` → `applyDumpSettings`) відновлюються результати й налаштування: персистентні пишуться в `settings.json`, sitemap — у сесійну памʼять UI. Старі дампи без `settings` лишаються валідними.

## Модель даних `spider-result`

```js
{
  url: string,
  status: number | 'ERROR' | '',
  external: boolean,
  fetched: boolean,
  kind?: string,
  tag?: string,
  text?: string,
  title?: string,          // лише HTML-сторінки; JS/CSS/media — порожній
  referrers: [{
    href: string,
    text: string,
    rel?: string,
    tag?: string,
    kind?: string,
    relFollowAllowed?: boolean | null,
    relIndexAllowed?: boolean | null,
    relLabel?: string,
  }],
  contentType?: string,
  metaDescription?: string,
  metaCanonical?: string,
  metaRobots?: string,
  metaRobotsStatus?: 'none' | 'allowed' | 'noindex' | 'nofollow' | 'closed',
  metaRobotsLabel?: string,
  xRobotsTag?: string,
  xRobotsTagStatus?: 'none' | 'allowed' | 'noindex' | 'nofollow' | 'closed',
  xRobotsTagLabel?: string,
  responseHeaders?: [{ name: string, value: string }],
  robotsAllowed?: boolean | null,
  robotsRule?: string,
  headings?: [{ level: number, text: string }],
  redirectUrl?: string,
  redirectHopCount?: number,
  redirectFinalUrl?: string,
  redirectInfinite?: boolean,
  redirectChain?: string[],
  redirectLoopStartUrl?: string,
  rel?: string,
  relFollowAllowed?: boolean | null,
  relIndexAllowed?: boolean | null,
  relLabel?: string
}
```

**Зберігання:** in-memory only. Main — `visitedUrls`, `reportedStubUrls`, `queue`, `referrersMap`, `robotsCache`. Renderer — `scanResults: Map` (усі посилання в одному масиві за ключем URL). Персистентності немає.

## Таблиця сторінок (renderer.js)

- **Вкладки типу** (`#contentTypeTabs`) над фільтрами: Усі / HTML / JavaScript / CSS / Media — фільтрують рядки і **профіль колонок** таблиці (`applyTableViewProfile` у `ui-logic.js`):
  - **Усі, HTML** — повна таблиця (усі колонки, включно з OG через плагін);
  - **Media** — … колонка **alt**; сортування alt (asc): `—` і лише `немає` (tier 0) → мікс `немає`+текст → лише `(порожній)` → мікс `(порожній)`+текст → алфавіт;
  - **JavaScript, CSS** — без колонок мета-сторінки та H1 (Content-Type лишається).
- При зміні вкладки скидається сортування, якщо колонка більше не видима.
- Спочатку рендериться **100** рядків (`TABLE_VISIBLE_INITIAL`); решта — по **50** при прокрутці вниз (`TABLE_LAZY_LOAD_SIZE`).
- Контейнер `#pagesTableScroll` — **горизонтальний і вертикальний** скрол (`results-table-wrap`). Таблиця `#resultsDataTable` має `width: max-content; min-width: 100%` — колонки не стискаються нижче заданої ширини.
- Заголовки з хуків `ui:tableColumns`; ширини — `colgroup` + `table-column-layout.js`. **Resize:** перетягніть правий край заголовка; подвійний клік на роздільнику — скинути ширину. Збереження в `localStorage` (`spider.resultsTableColumnWidths`).
- Лічильник «У таблиці: N з M» — скільки рядків у DOM vs скільки пройшло фільтри.
- **CSV export** використовує `getDisplayedResults()` повністю, без обмеження таблиці.

## Фільтри таблиці (renderer.js)

- **Тип** — вкладки `#contentTypeTabs` (див. вище); класифікація URL у `scanResults`:
  - `HTML` — завантажені URL з `Content-Type: text/html` / `application/xhtml`;
  - `JavaScript` / `CSS` / `Media` — за `kind`, тегом (`script[src]`, `link[rel=stylesheet]`) і розширенням URL;
  - `Усі` — усі записи в `scanResults`.
- **Джерело** — `external: true/false` (або `hostname` URL).
- Стан фільтрів — `activeContentFilter`, `activeSourceFilter` у пам’яті; не скидається під час сканування.
- Інші фільтри: статус HTTP, індексація, H1, дублікати.

Колонки **Внутр.** / **Зовн.** — кількість посилань **з** обраної сторінки (через `referrersMap`: хто посилається **на** URL з цієї сторінки як джерела).

**Вихідні / вхідні посилання (панель деталей):** `rel`, `tag`, `kind` зберігаються на ребрі referrer (сторінка-джерело → цільовий URL), а не лише в stub цілі. Таблиця без колонки «Тип»; усі колонки сортуються (`linkTableSortState`).

## CSV export (renderer.js)

- BOM `\uFEFF` для Excel/кирилиці.
- **Основна таблиця:** експорт відфільтрованих сторінок; колонки включають Internal/External Links (скорочений preview у комірках).
- Файл основного експорту: `spider_<hostname>_YYYY-MM-DD-HH-MM-SS.csv`.
- **Вкладки «Вхідні» / «Вихідні посилання»** (панель деталей): кнопка «Експорт CSV» — повний список посилань окремим файлом (без обмеження довжини комірки). Колонки: URL, Tag, rel, Follow, Anchor Text (+ External для вихідних). Сортування як у таблиці вкладки.
- Ім'я файлу посилань: `<host>_<path>-in|out-YYYY-MM-DD-HH-MM-SS.csv` (час старту скану).
- Дамп: `spider_<hostname>_YYYY-MM-DDTHH-MM-SS.spider.json` — результати + `settings` (усі опції спайдера і `sitemapUrlsText`).

## Збір посилань (link-collector.js)

- `<link rel="preconnect">` і `<link rel="dns-prefetch">` пропускаються під час `collectPageLinks` — вони не є адресами URL-ресурсів.
- Атрибут **`srcset`** (`img`, `picture source`) — усі кандидати з рядка (`parseSrcsetUrls` у `url-utils.js`), не лише перший; кожен URL probe-иться окремо.

## Залежності

| Пакет | Використання |
|-------|--------------|
| `cheerio` | HTML parsing (main) |
| `robots-parser` | robots.txt (main) |
| `electron` 42.3.3 | Desktop shell (пінована версія) |
| `tailwindcss` + `@tailwindcss/postcss` | Стилі (build time; vendor prefixes вбудовані в Tailwind v4) |

## Команди

```bash
npm install            # postinstall докачує бінарник Electron
npm test               # unit-тести (scripts/run-tests.mjs → node:test)
npm start              # build:css + electron-forge start
npm run build:css      # input.css → styles.css
npm run prebuild       # test + build:css (перед package/make)
npm run package        # пакування в out/ (prepackage → prebuild)
npm run make           # дистрибутив поточної ОС (premake → prebuild)
npm run make:all       # Linux + Windows + macOS zip (prebuild один раз)
npm run all            # alias make:all
npm run make:linux     # лише Linux (zip)
npm run build:icons    # перегенерація icon.ico з icon.png (ImageMagick)
npm run install:linux  # встановити/оновити (без збірки)
npm run deploy:linux   # make:linux + install
npm run make:win       # Windows zip (з Linux); Setup.exe — лише збірка на Windows
npm run make:mac       # macOS zip (з Linux); dmg — лише збірка на Mac
```

Конфіг збірки — `forge.config.js`. Збірку запускати з **терміналу** або через **Tasks** (`.vscode/tasks.json`): **build: linux**, **install: linux** тощо — не через npm Scripts у боковій панелі, Forge зависає без TTY. У скриптах стоїть `CI=true`, щоб обійти це. Тести — **Tasks → test** або `npm test`.

`make:all` з Linux дає zip для linux/win32/darwin; Squirrel Setup.exe — лише на Windows, dmg — лише на macOS (`forge.config.js`).

`styles.css` у `.gitignore` — `build:css` запускається автоматично перед `start`; перед `package` і `make*` спочатку `npm test`, потім `build:css` (`prebuild`).

**Якщо Forge падає з `ENOENT path.txt`:** завантаження бінарника Electron перервалось (мережа). Виправлення: `node node_modules/electron/install.js` або повторний `npm install`.

## Тести

- **Runner:** вбудований `node:test` + `node:assert/strict` (без додаткових dev-залежностей).
- **Команда:** `npm test` — `scripts/run-tests.mjs` знаходить усі `tests/**/*.test.js` і запускає `node --test` (glob у npm-скрипті ненадійний).
- **Покриття:**
  - `shared/user-agents` — пресети UA, resolve для fetch і robots.txt;
  - `shared/url-utils` — нормалізація URL, redirect, content-type;
  - `shared/hook-registry` — waterfall, filter, unregister;
  - `main/crawl-hooks` — extract, emit, filter links;
  - `main/spider-logic` — парсинг HTML, robots/meta, черга, crawl/startSpider (mock fetch);
  - `main/settings-persistence` — normalize/save/load (mock `electron.app`);
  - `main/request-delay` — normalize, jitter, пауза перед fetch;
  - `main/http-auth` — Basic/Bearer, обмеження за hostname;
  - `main/session-dump` — валідація дампу;
  - `renderer/ui-logic` — фільтри, класифікація, сортування, CSV preview;
  - `renderer/ui-hooks` — патерн розширення колонок;
  - `renderer/session-dump` — серіалізація результатів + `settings` у дампі;
  - `renderer/settings-store` — collect/apply dump settings, session sitemap;
  - `renderer/renderer-scope` — smoke завантаження renderer-модулів;
  - `preload` — whitelist IPC-каналів.
- **Не покрито E2E:** Electron UI, реальні HTTP-запити, діалоги файлів — лише unit/integration на рівні модулів.

## Відомі обмеження / техборг

- `spider-logic.js` (~1700 рядків) — можна розбити на queue, referrers, probe, sitemap (фаза 3).
- UI українською.
- Немає README, `.env` / config-файлів.

## Типові місця для правок

| Задача | Де шукати |
|--------|-----------|
| Ліміт сторінок, timeout, UA | `spider-logic.js` константи |
| Нова мета-інформація з HTML | хук `crawl:extractPage` або `page-extractors.js` |
| Нове поле в UI / CSV | хуки `ui:tableColumns`, `ui:detailRows`, `ui:exportColumns` |
| Трансформація збережених даних | хук `ui:transformResult` у `scan-store.js` |
| Новий IPC event | `main.js` + `preload.js` + `renderer.js` |
| Unit-тести логіки | `tests/` + відповідний модуль у `src/` |
| Стилі | `input.css` / Tailwind класи в `index.html` |
| Безпека IPC | `preload.js` whitelist |
