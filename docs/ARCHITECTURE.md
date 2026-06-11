# Spider-Electron — внутрішня документація

> Останнє оновлення: 2026-06-11 (фікс JS/CSS у таблиці, materialize з referrers)  
> Короткий довідник для розробки та правок. Детальніше про підтримку — [DOC_MAINTENANCE.md](./DOC_MAINTENANCE.md).

## Що це

Desktop-краулер на **Electron**: main process обходить сайт по HTTP і парсить HTML, renderer показує результати та експортує CSV. Проєкт монолітний — **6 вихідних файлів**, без окремих модулів і тестів.

## Структура файлів

```
src/
├── main/main.js          # Electron lifecycle + вся логіка краулера
├── preload/preload.js    # IPC bridge (contextBridge → window.api)
└── renderer/
    ├── index.html        # UI shell, CSP
    ├── input.css         # Tailwind source
    ├── styles.css        # згенерований CSS (gitignored)
    ├── renderer.js       # UI: таблиця + панель деталей
    ├── settings.html     # сторінка налаштувань
    ├── settings.js
    └── settings-store.js # IPC → settings.json у userData
```

| Файл | Відповідальність |
|------|------------------|
| `main.js` | BFS-обхід, fetch, robots.txt, cheerio, IPC events |
| `preload.js` | Whitelist каналів IPC, `window.api` |
| `renderer.js` | Валідація URL, рендер, `scanResults` Map, CSV, фільтри таблиці сторінок |
| `index.html` | Розмітка, Tailwind класи |

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
2. Перевірка `robots.txt` (кеш `robotsCache` по host). Блок → `status: 'SKIPPED'`.
3. `fetch` з timeout 5s, `redirect: 'manual'`, User-Agent `MyElectronSpider/1.0`.
4. **3xx** — фіксація `redirectUrl`, enqueue цілі (лише той самий `hostname`).
5. **4xx/5xx** — `status: 'ERROR'`.
6. **200** — cheerio: title, meta description, canonical, headings, link count → `spider-result`.
7. Якщо `<meta name="robots" content="nofollow">` — не додає нові посилання.
8. Збір URL з HTML: `<a>`, `<link>`, `<script>`, `<img>`, … — завантажені сторінки через `spider-result`; JS/CSS/медіа та зовнішні — пакетом `spider-results-batch` (`fetched: false`). **Завантажуються** лише внутрішні навігаційні: `a[href]`, `area[href]`, `form[action]`, внутрішні `iframe[src]` (HTML). Для не-навігаційних ресурсів (скрипти, стилі, медіа) stub створюється **завжди**, навіть якщо URL у черзі; для навігаційних — лише якщо URL ще не обійдений і не в черзі.

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
| M → R | `spider-result` | один об'єкт посилання (завантажене) |
| M → R | `spider-results-batch` | масив знайдених, не завантажених посилань |
| M → R | `spider-progress` | `{ scanned, queue, active?, status?, finished? }` |
| M → R | `spider-referrers-update` | `{ [url]: referrers[] }` |
| M → R | `spider-end` | `message: string` |

Нові канали — додати в `preload.js` (`validSendChannels` / `validReceiveChannels`) і в `contextBridge`.

## Модель даних `spider-result`

```js
{
  url: string,
  status: number | 'ERROR' | 'SKIPPED' | '',
  external: boolean,
  fetched: boolean,
  kind?: string,
  tag?: string,
  text?: string,
  title?: string,
  referrers: [{ href: string, text: string }],
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

## Фільтри таблиці (renderer.js)

- **Тип** — класифікація **самого URL** в `scanResults`:
  - `HTML` — завантажені URL з `Content-Type: text/html` / `application/xhtml`;
  - `JavaScript` / `CSS` / `Media` — за `kind`, тегом (`script[src]`, `link[rel=stylesheet]`) і розширенням URL;
  - `Усі` — усі записи в `scanResults`.
- **Джерело** — `external: true/false` (або `hostname` URL).
- Стан фільтрів — `activeContentFilter`, `activeSourceFilter` у пам’яті; не скидається під час сканування.
- Інші фільтри: статус HTTP, індексація, H1, дублікати.

Колонки **Внутр.** / **Зовн.** — кількість посилань **з** обраної сторінки (через `referrersMap`: хто посилається **на** URL з цієї сторінки як джерела).

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
npm start              # build:css + electron-forge start
npm run build:css      # input.css → styles.css
npm run package        # пакування в out/ (prepackage → build:css)
npm run make           # дистрибутиви Linux/Windows (premake → build:css)
npm run make:linux     # лише Linux (zip)
npm run make:win       # Windows zip (з Linux); Setup.exe — лише збірка на Windows
npm run make:mac       # лише macOS (dmg + zip); збирати на Mac
```

Конфіг збірки — `forge.config.js`. Збірку запускати з **терміналу** або через **Tasks → make (Linux)** (`.vscode/tasks.json`), не через npm Scripts у боковій панелі — Forge зависає без TTY. У скриптах стоїть `CI=true`, щоб обійти це.

`styles.css` у `.gitignore` — `build:css` запускається автоматично перед `start`, `package`, `make`.

**Якщо Forge падає з `ENOENT path.txt`:** завантаження бінарника Electron перервалось (мережа). Виправлення: `node node_modules/electron/install.js` або повторний `npm install`.

## Відомі обмеження / техборг

- Монолітний `main.js` (~296 рядків) — рефакторинг потрібен для concurrency, multi-domain, sitemap.
- UI українською.
- Немає тестів, README, `.env` / config-файлів.

## Типові місця для правок

| Задача | Де шукати |
|--------|-----------|
| Ліміт сторінок, timeout, UA | `main.js` константи |
| Нова мета-інформація з HTML | `crawl()` cheerio-блок ~164–186 |
| Нове поле в UI / CSV | `renderer.js` `onSpiderResult` + export |
| Новий IPC event | `main.js` + `preload.js` + `renderer.js` |
| Стилі | `input.css` / Tailwind класи в `index.html` |
| Безпека IPC | `preload.js` whitelist |
