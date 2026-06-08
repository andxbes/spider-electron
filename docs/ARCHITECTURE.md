# Spider-Electron — внутрішня документація

> Останнє оновлення: 2026-06-08 (sitemap)  
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
    └── renderer.js       # UI, accordion, CSV export
```

| Файл | Відповідальність |
|------|------------------|
| `main.js` | BFS-обхід, fetch, robots.txt, cheerio, IPC events |
| `preload.js` | Whitelist каналів IPC, `window.api` |
| `renderer.js` | Валідація URL, рендер, `scanResults` Map, CSV |
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
8. `<a href>` → абсолютні URL без `#`, лише той самий `hostname` → `queue` + `referrersMap`.

**Завершення:** порожня черга або досягнуто `maxPages` (якщо > 0) → `spider-referrers-update` → `spider-end`.

## Константи (hardcoded у `main.js`)

| Константа | Значення | Рядок |
|-----------|----------|-------|
| `maxPages` (опція UI) | 0 = без ліміту | renderer → main |
| HTTP timeout | 5000 ms | ~98 |
| User-Agent | `MyElectronSpider/1.0` | ~81, ~101 |
| Область обходу | один `hostname` | ~146, ~210 |

Зміни цих параметрів — правити `main.js` і оновити цю таблицю.

## IPC-канали

| Напрямок | Канал | Payload |
|----------|-------|---------|
| R → M | `start-spider` | `{ startUrl, options: { useSitemap?: boolean, maxPages?: number } }` |
| M → R | `spider-result` | об'єкт сторінки (див. нижче) |
| M → R | `spider-progress` | `{ scanned, queue, status? }` |
| M → R | `spider-referrers-update` | `{ [url]: referrers[] }` |
| M → R | `spider-end` | `message: string` |

Нові канали — додати в `preload.js` (`validSendChannels` / `validReceiveChannels`) і в `contextBridge`.

## Модель даних `spider-result`

```js
{
  status: number | 'ERROR' | 'SKIPPED',
  url: string,
  title: string,
  referrers: string[],
  metaDescription?: string,
  metaCanonical?: string,
  linkCount?: number,
  headings?: [{ level: number, text: string }],
  redirectUrl?: string
}
```

**Зберігання:** in-memory only. Main — `visitedUrls`, `queue`, `referrersMap`, `robotsCache`. Renderer — `scanResults: Map`. Персистентності немає.

## CSV export (renderer.js)

- BOM `\uFEFF` для Excel/кирилиці.
- Колонки: URL, Status, Title, Meta Description, Canonical, Link Count, Redirect URL, Referrers, Headings.
- Файл: `spider_results_YYYY-MM-DD.csv`.

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
npm run package        # пакування в out/
npm run make           # дистрибутиви
```

`styles.css` у `.gitignore` — перед запуском потрібен `build:css`.

**Якщо Forge падає з `ENOENT path.txt`:** завантаження бінарника Electron перервалось (мережа). Виправлення: `node node_modules/electron/install.js` або повторний `npm install`.

## Відомі обмеження / техборг

- Монолітний `main.js` (~296 рядків) — рефакторинг потрібен для concurrency, multi-domain, sitemap.
- `forge.config.js` відсутній у репо (є `out/` від минулого package).
- UI російською.
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
