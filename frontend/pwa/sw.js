/* global self, caches, fetch, URL, BUILD_ID, PRECACHE_URLS */
/*
 * Service worker CraneApp (#880): установка на экран «Домой» и запуск без
 * сети. Данные не кешируются никогда.
 *
 * Это шаблон: при сборке плагин из vite.config.ts дописывает в начало
 * BUILD_ID (хеш списка файлов сборки) и PRECACHE_URLS (файлы оболочки) и
 * кладёт результат в dist/sw.js. Новая сборка — новый sw.js: браузер сам
 * ставит новый worker, а тот удаляет кеши прежней.
 *
 * - Навигация — сначала сеть: после деплоя сразу открывается новая версия.
 *   Кеш — только без сети: тогда отдаётся последняя загруженная оболочка.
 * - /assets/* — имена с хешем содержимого, файл никогда не меняется: из
 *   кеша, а нет в кеше — из сети с сохранением. Файлы оболочки кладутся в
 *   кеш заранее, при установке worker, — без сети открывается любой экран.
 * - /locales/* — переводы: сначала сеть, без сети — из кеша.
 * - Всё остальное (/api, /ws, медиа, чужие адреса) не перехватывается
 *   вовсе: ответы API и медиа не должны оставаться на устройстве после
 *   выхода из аккаунта.
 */

const SHELL_CACHE = 'craneapp-shell-' + BUILD_ID;
const ASSETS_CACHE = 'craneapp-assets-' + BUILD_ID;
const SHELL_URL = '/index.html';
/** Столько файлов сборки держим: догружаемые по ходу работы не копятся без края. */
const MAX_ASSETS = 300;

/** Как обрабатывать запрос: 'navigate', 'asset', 'locale' или null — не трогать. */
function strategyFor(request) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return null;
  if (request.mode === 'navigate') {
    // Отдельные страницы (звонок, «сервер недоступен»), документация API и
    // старая мобильная версия — не оболочка приложения: как есть.
    if (url.pathname.endsWith('.html') && url.pathname !== SHELL_URL) return null;
    if (/^\/(docs|mobile)(\/|$)/.test(url.pathname)) return null;
    return 'navigate';
  }
  // Файлы сборки и картинки оболочки (логотип на входе, иконки): кеш
  // привязан к сборке, так что и не хешированные имена не залипают.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) return 'asset';
  if (url.pathname === '/logo.png') return 'asset';
  if (url.pathname.startsWith('/locales/')) return 'locale';
  return null;
}

async function trimAssets() {
  const cache = await caches.open(ASSETS_CACHE);
  const keys = await cache.keys();
  const extra = keys.length - MAX_ASSETS;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function handleNavigate(request) {
  try {
    const response = await fetch(request);
    const isPage = (response.headers.get('content-type') || '').includes('text/html');
    if (response.ok && isPage) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
    if (cached) return cached;
    throw error;
  }
}

async function handleAsset(request) {
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trimAssets();
  }
  return response;
}

async function handleLocale(request) {
  const cache = await caches.open(ASSETS_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

/** Оболочка и её файлы — заранее. Не скачался один файл — остальные всё равно. */
async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  await shell.add(SHELL_URL).catch(() => undefined);
  const assets = await caches.open(ASSETS_CACHE);
  await Promise.all(PRECACHE_URLS.map((url) => assets.add(url).catch(() => undefined)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // Кеши прежних сборок — удалить.
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith('craneapp-') && name !== SHELL_CACHE && name !== ASSETS_CACHE
            )
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request);
  if (strategy === 'navigate') event.respondWith(handleNavigate(event.request));
  else if (strategy === 'asset') event.respondWith(handleAsset(event.request));
  else if (strategy === 'locale') event.respondWith(handleLocale(event.request));
});
