# Spider-Electron — внутрішня документація

> Останнє оновлення: 2026-06-14 (модальне «Про програму» в меню Файл, версія з package.json)  
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
│   └── hook-registry.js   # Реєстр хуків (waterfall / filter / tap)
├── main/
│   ├── main.js            # Electron lifecycle + IPC
│   ├── app-about.js       # Метадані застосунку (версія, автор)
│   ├── spider-logic.js  # Оркестратор: crawl, startSpider (~620 рядків)
│   ├── crawl-state.js   # Mutable state: visited, queues, session
│   ├── crawl-network.js # Fetch, robots.txt, таймаути
│   ├── crawl-results.js # buildSpiderResult, meta robots parsing
│   ├── crawl-referrers.js # referrersMap, add/merge referrers
│   ├── crawl-queue.js   # html/media/probe черги, enqueue/dequeue
│   ├── crawl-sitemap.js # Sitemap discovery і seed черги
│   ├── probe.js         # probeDiscoveredLink, reportDiscoveredLinks
│   ├── link-collector.js # Збір і класифікація outlinks з HTML
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
├── main/spider-logic.test.js
├── main/crawl-hooks.test.js
├── main/plugins/og-meta.test.js
├── main/settings-persistence.test.js
├── main/session-dump.test.js
├── renderer/ui-logic.test.js
├── renderer/ui-hooks.test.js
├── renderer/session-dump.test.js
├── renderer/renderer-scope.test.js
└── preload/ipc-channels.test.js
```

| Файл | Відповідальність |
|------|------------------|
| `main.js` | Electron lifecycle, IPC handlers |
| `spider-logic.js` | Оркестратор: `crawl`, `startSpider`, re-export для тестів |
| `crawl-state.js` | `visitedUrls`, черги, `scanSession`, `tryClaimUrl` |
| `crawl-network.js` | `fetchPage`, `getRobots`, `getRobotsTxtFieldsForUrl` |
| `crawl-results.js` | `buildSpiderResult`, `parseMetaRobotsDirective`, indexing |
| `crawl-referrers.js` | `referrersMap`, `addReferrer`, `getReferrersSnapshot` |
| `crawl-queue.js` | `enqueueUrl`, `dequeueNextUrl`, `hasPendingWork`, media queue |
| `crawl-sitemap.js` | `discoverSitemapUrls`, `seedQueueFromSitemaps` |
| `probe.js` | HTTP-probe зовнішніх/медіа посилань, stub batch |
| `link-collector.js` | `collectPageLinks`, класифікація outlinks, `isCrawlableLink` |
| `page-extractors.js` | Витяг title, meta, headings, meta robots з cheerio |
| `crawl-hooks.js` | Точки розширення збору; `emitSpiderResult` перед IPC |
| `hook-registry.js` | Універсальний реєстр хуків (main + renderer) |
| `preload.js` | Whitelist каналів IPC, `window.api` |
| `ui-logic.js` | Фільтри, класифікація ресурсів, rel/meta, дублікати, сортування |
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

**Підключення main:** `src/main/plugins/index.js` → `require('./plugins')` у `spider-logic.js` (після `crawl-defaults`).

**Підключення renderer:** `<script src="./plugins/og-meta.js">` у `index.html` (після `ui-defaults.js`).

**og-meta** збирає `og:title`, `og:description`, `og:image` через `crawl:extractPage`; додаткові поля з extractors потрапляють у `spider-result` через spread `pluginPageFields` у `crawl()`. UI: колонки «OG Title» / «OG Image», рядки в деталях, колонки CSV. Заголовки таблиці (`#pagesTableHead`) будуються динамічно з `ui:tableColumns` — плагіни додають колонки без правки `index.html`.

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
    ↓ crawl() → fetch + cheerio
    ↑ webContents.send('spider-*')
Renderer
```

- Мережеві запити — **тільки в main** (правильно для безпеки).
- Renderer не має Node.js; доступ лише через `window.api`.
- `contextIsolation` не заданий явно — діють дефолти Electron (зазвичай `true`).

## Алгоритм краулера

**Тип:** BFS (черга `queue`, FIFO через `shift()`).

**Запуск:** `ipcMain.on('start-spider')` → `startSpider()` → `processQueue()` (рекурсія через `setTimeout(..., 0)`).

**Опція sitemap (`useSitemap`):** перед обходом читається `robots.txt`, з нього витягуються рядки `Sitemap:`. Якщо їх немає — пробуються `/sitemap_index.xml`, `/sitemap.xml`, `/index.xml`. XML парситься (індекс + вкладені sitemap + `urlset`), URL сторінок додаються в чергу **першими**. Referrer для таких URL — адреса sitemap-файлу.

**На кожній сторінці (`crawl`):**

1. Skip, якщо URL вже в `visitedUrls` або ліміт досягнуто.
2. Перевірка **robots.txt** (внутрішні URL) — якщо `Disallow`, HTTP-запит **не** виконується: ні `crawl`, ні `probe`; `status: 0`. Зовнішні URL перевіряються по HTTP навіть при забороні в robots.txt їхнього хоста.
3. `fetch` з timeout 5s, `redirect: 'manual'`, User-Agent `MyElectronSpider/1.0`.
4. **3xx** — фіксація `redirectUrl`, enqueue цілі (лише той самий `hostname`); ціль redirect теж перевіряється robots.txt перед fetch.
5. **4xx/5xx** — `status` = код відповіді, `title` порожній.
6. **200** — cheerio: title, meta description, canonical, headings, link count → `spider-result`.
7. Якщо `<meta name="robots" content="nofollow">` — не додає нові посилання.
8. Збір URL з HTML: `<a>`, `<link>`, `<script>`, `<img>`, … — HTML-сторінки через `crawl`; **медіа, CSS, JS і зовнішні** — stub у batch, потім **probe** (status + `content-type` + robots.txt + `X-Robots-Tag`, без HTML) — навіть при `rel=nofollow`. BFS лише для внутрішніх навігаційних: `a[href]`, `area[href]`, `form[action]`, `iframe[src]` (HTML). Stub для не-навігаційних ресурсів — **завжди**; для навігаційних — лише якщо URL не в черзі обходу.

**Завершення:** порожня черга або досягнуто `maxPages` (якщо > 0) → `spider-referrers-update` → `spider-end`. На renderer після referrers — `materializeDiscoveredFromReferrers()`: URL з referrers, яких немає в `scanResults`, додаються як знайдені (`fetched: false`).

## Константи (hardcoded у `main.js`)

| Константа | Значення | Рядок |
|-----------|----------|-------|
| `maxPages` (опція UI) | 0 = без ліміту | renderer → main |
| `concurrency` (опція UI) | 1–50, за замовч. 3 | паралельних `crawl()` |
| HTTP timeout | 5000 ms | ~98 |
| User-Agent | `MyElectronSpider/1.0` | ~81, ~101 |
| Область обходу | один `hostname` | ~146, ~210 |

Зміни цих параметрів — правити `main.js` і оновити цю таблицю.

## IPC-канали

| Напрямок | Канал | Payload |
|----------|-------|---------|
| R → M | `start-spider` | `{ startUrl, options: { useSitemap?, maxPages?, concurrency? } }` |
| R → M | `spider-pause` / `spider-resume` / `spider-stop` | керування скануванням |
| R → M | `shell:open-external` | відкрити URL у браузері |
| R ↔ M | `settings:get` / `settings:save` | налаштування (файл у userData) |
| R ↔ M | `app:getAbout` | `{ name, version, author, email }` — версія з `package.json` через `app.getVersion()` |
| M → R | `about-show` | відкрити модальне «Про програму» (меню «Про програму») |
| M → R | `spider-result` | один об'єкт посилання (завантажене) |
| M → R | `spider-results-batch` | масив знайдених, не завантажених посилань |
| M → R | `spider-progress` | `{ scanned, queue, active?, status?, finished? }` |
| M → R | `spider-referrers-update` | `{ referrers: { [url]: referrers[] }, robotsByUrl: { [url]: { robotsAllowed, robotsRule } } }` |
| M → R | `spider-end` | `message: string` |

Нові канали — додати в `preload.js` (`validSendChannels` / `validReceiveChannels`) і в `contextBridge`.

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
  headings?: [{ level: number, text: string }],
  redirectUrl?: string,
  rel?: string,
  relFollowAllowed?: boolean | null,
  relIndexAllowed?: boolean | null,
  relLabel?: string
}
```

**Зберігання:** in-memory only. Main — `visitedUrls`, `reportedStubUrls`, `queue`, `referrersMap`, `robotsCache`. Renderer — `scanResults: Map` (усі посилання в одному масиві за ключем URL). Персистентності немає.

## Таблиця сторінок (renderer.js)

- Спочатку рендериться **100** рядків (`TABLE_VISIBLE_INITIAL`); решта — по **50** при прокрутці вниз (`TABLE_LAZY_LOAD_SIZE`).
- Контейнер `#pagesTableScroll` — **горизонтальний і вертикальний** скрол (`results-table-wrap`). Таблиця `#resultsDataTable` має `width: max-content; min-width: 100%` — колонки не стискаються нижче заданої ширини.
- Заголовки з хуків `ui:tableColumns`; ширини — `colgroup` + `table-column-layout.js`. **Resize:** перетягніть правий край заголовка; подвійний клік на роздільнику — скинути ширину. Збереження в `localStorage` (`spider.resultsTableColumnWidths`).
- Лічильник «У таблиці: N з M» — скільки рядків у DOM vs скільки пройшло фільтри.
- **CSV export** використовує `getDisplayedResults()` повністю, без обмеження таблиці.

## Фільтри таблиці (renderer.js)

- **Тип** — класифікація **самого URL** в `scanResults`:
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
- Експорт відфільтрованих сторінок; колонки включають Internal Links, External Links.
- Файл: `spider_filtered_YYYY-MM-DD.csv`.

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
  - `shared/url-utils` — нормалізація URL, redirect, content-type;
  - `shared/hook-registry` — waterfall, filter, unregister;
  - `main/crawl-hooks` — extract, emit, filter links;
  - `main/spider-logic` — парсинг HTML, robots/meta, черга, crawl/startSpider (mock fetch);
  - `main/settings-persistence` — normalize/save/load (mock `electron.app`);
  - `main/session-dump` — валідація дампу;
  - `renderer/ui-logic` — фільтри, класифікація, сортування, CSV preview;
  - `renderer/ui-hooks` — патерн розширення колонок;
  - `renderer/session-dump` — серіалізація результатів;
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
