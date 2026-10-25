/* global self, caches, fetch, URL, setTimeout, BUILD_ID, PRECACHE_URLS */
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
 *   Сеть не ответила за NAVIGATE_TIMEOUT_MS или её нет — отдаётся последняя
 *   загруженная оболочка, а пришедший позже ответ обновит её в кеше (#899).
 * - /assets/* — имена с хешем содержимого, файл никогда не меняется: из
 *   кеша, а нет в кеше — из сети с сохранением. Файлы оболочки кладутся в
 *   кеш заранее, при установке worker, — без сети открывается любой экран.
 * - /locales/* — переводы: сначала сеть, без сети — из кеша.
 * - /version.json (#892) — какая сборка на сервере: не перехватывается,
 *   иначе приложение сверяло бы версию с самим собой.
 * - Всё остальное (/api, /ws, медиа, чужие адреса) не перехватывается
 *   вовсе: ответы API и медиа не должны оставаться на устройстве после
 *   выхода из аккаунта.
 * - push и notificationclick — уведомления о сообщениях и звонках (ниже).
 */

const SHELL_CACHE = 'craneapp-shell-' + BUILD_ID;
const ASSETS_CACHE = 'craneapp-assets-' + BUILD_ID;
const SHELL_URL = '/index.html';
/** Столько файлов сборки держим: догружаемые по ходу работы не копятся без края. */
const MAX_ASSETS = 300;
/** Дольше медленная сеть не держит белый экран: дальше — оболочка из кеша (#899). */
const NAVIGATE_TIMEOUT_MS = 800;

/** Как обрабатывать запрос: 'navigate', 'asset', 'locale' или null — не трогать. */
function strategyFor(request) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return null;
  if (request.mode === 'navigate') {
    // Отдельные страницы («сервер недоступен»), документация API и
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

async function fetchShell(request) {
  const response = await fetch(request);
  const isPage = (response.headers.get('content-type') || '').includes('text/html');
  if (response.ok && isPage) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(SHELL_URL, response.clone());
  }
  return response;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleNavigate(event) {
  const network = fetchShell(event.request);
  event.waitUntil(network.catch(() => undefined));

  const fresh = await Promise.race([
    network.catch(() => null),
    delay(NAVIGATE_TIMEOUT_MS).then(() => null),
  ]);
  if (fresh) return fresh;

  const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
  return cached || network;
}

/*
 * Искать в кеше без учёта Vary. Файл, положенный заранее (при установке,
 * запрос без Origin), иначе не находится по запросу import() — если сервер
 * помечает ответы `Vary: Origin` (так делает vite preview). Тогда кусок
 * уже удалённой с сервера сборки шёл в сеть и получал страницу вместо файла
 * (#892). Файлы сборки с хешем в имени не меняются — Vary им не нужен.
 */
const MATCH_OPTIONS = { ignoreVary: true };

async function handleAsset(request) {
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(request, MATCH_OPTIONS);
  if (cached) return cached;
  const response = await fetch(request);
  // Страница приложения вместо файла (старый сервер отдавал её на любой
  // отсутствующий путь) — не файл сборки: в кеш под его именем — нельзя.
  const isPage = (response.headers.get('content-type') || '').includes('text/html');
  if (response.ok && !isPage) {
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
    const cached = await cache.match(request, MATCH_OPTIONS);
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

/*
 * Обновление (#892). Первая установка включается сразу: страницы, которую
 * она сменила бы, ещё нет. Новая сборка поверх работающей — ждёт, пока
 * человек нажмёт «Обновить» (сообщение craneapp:update): иначе новый
 * worker раздавал бы файлы новой сборки странице старой, а страница о
 * новой версии и не знала бы.
 */
self.addEventListener('install', (event) => {
  const firstInstall = !self.registration.active;
  event.waitUntil(precache().then(() => (firstInstall ? self.skipWaiting() : undefined)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'craneapp:update') self.skipWaiting();
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

/*
 * Push-уведомления (#882, сервер — #717). В push — вид события, чат, имя
 * отправителя и язык получателя; текста сообщения нет (сквозное
 * шифрование). Показывать надо каждый push: iOS отбирает разрешение у
 * сайта, который получил push и промолчал.
 */
const PUSH_TEXT = {
  ru: {
    message: 'Новое сообщение',
    call: 'Входящий звонок',
    videoCall: 'Входящий видеозвонок',
    missedCall: 'Пропущенный звонок',
    fallback: 'CraneApp',
  },
  en: {
    message: 'New message',
    call: 'Incoming call',
    videoCall: 'Incoming video call',
    missedCall: 'Missed call',
    fallback: 'CraneApp',
  },
};

/** Заголовок, текст и поведение уведомления по содержимому push. */
function notificationFor(data) {
  const text = PUSH_TEXT[data.lang] || PUSH_TEXT.ru;
  const name = data.actorName || text.fallback;
  const url = data.chatId ? '/chats/' + encodeURIComponent(data.chatId) : '/';
  // Старые payload без policy тоже показываем, но без непроверенного звука.
  const silent = data.kind === 'missed_call' || data.silent !== false;
  const base = { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url }, silent };

  if (data.kind === 'call' || data.kind === 'missed_call') {
    const missed = data.kind === 'missed_call';
    return {
      title: name,
      options: Object.assign({}, base, {
        body: missed ? text.missedCall : data.callKind === 'video' ? text.videoCall : text.call,
        // Пропущенный заменяет входящий: тот же тег.
        tag: 'call:' + (data.roomId || data.chatId),
        renotify: !missed && !silent,
        requireInteraction: !missed,
      }),
    };
  }

  // В группе — название группы и кто написал; в личном — имя.
  const group = data.chatType !== 'private' && data.chatTitle;
  return {
    title: group ? data.chatTitle : name,
    options: Object.assign({}, base, {
      body: group ? name + ': ' + text.message : text.message,
      // Одно уведомление на чат, и каждое новое звучит (см. showPush).
      tag: 'chat:' + data.chatId,
      renotify: !silent,
    }),
    closePrevious: true,
  };
}

/**
 * Показать push. Прежнее уведомление того же чата сначала закрывается, а
 * не заменяется: замену по тегу Safari (iPhone, Mac) и Firefox делают
 * молча — renotify они не поддерживают, — и пока первое уведомление
 * висело в Центре уведомлений, все следующие сообщения чата приходили без
 * звука и баннера. Закрытое — не замена: новое звучит. Звонок заменяется
 * как есть: пропущенный и должен тихо сменить входящий.
 */
async function showPush(data) {
  const { title, options, closePrevious } = notificationFor(data);
  if (closePrevious && self.registration.getNotifications) {
    try {
      const previous = await self.registration.getNotifications({ tag: options.tag });
      previous.forEach((notification) => notification.close());
    } catch {
      // Не вышло — покажем заменой, как раньше.
    }
  }
  return self.registration.showNotification(title, options);
}

self.addEventListener('push', (event) => {
  // Пустой или битый push — всё равно уведомление: промолчать нельзя.
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch {
    data = {};
  }
  event.waitUntil(showPush(data));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Приложение уже открыто — переход внутри него, без перезагрузки;
      // иначе — новое окно.
      const existing = windows.find(
        (client) => new URL(client.url).origin === self.location.origin
      );
      if (existing) {
        existing.postMessage({ type: 'craneapp:navigate', url });
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request);
  if (strategy === 'navigate') event.respondWith(handleNavigate(event));
  else if (strategy === 'asset') event.respondWith(handleAsset(event.request));
  else if (strategy === 'locale') event.respondWith(handleLocale(event.request));
});
