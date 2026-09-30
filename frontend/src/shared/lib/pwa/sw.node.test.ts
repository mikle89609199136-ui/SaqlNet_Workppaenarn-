import { beforeEach, describe, expect, it, vi } from 'vitest';
import source from '../../../../pwa/sw.js?raw';

/*
 * Настоящий шаблон pwa/sw.js (#880) в песочнице: поддельные self, caches и
 * fetch, номер сборки и список предзагрузки — как их дописывает плагин.
 * Главное — ответы API и медиа не попадают в кеш никогда.
 */

const ORIGIN = 'https://crane.test';
const BUILD_ID = 'test';
const PRECACHE_URLS = ['/assets/main-a.js', '/assets/main-a.css', '/locales/ru/translation.json'];

type Listener = (event: any) => void;

interface FakeWindow {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}
type FetchMock = ReturnType<typeof vi.fn<(request: Request) => Promise<Response>>>;

const keyOf = (request: Request | string) =>
  typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;

const originOf = (request: Request | string) =>
  typeof request === 'string' ? null : request.headers.get('origin');

class FakeCache {
  entries = new Map<string, Response>();
  /** Origin запроса, которым файл положили: для Vary, как в браузере. */
  private origins = new Map<string, string | null>();
  private readonly network: FetchMock;
  constructor(network: FetchMock) {
    this.network = network;
  }
  async match(request: Request | string, options?: { ignoreVary?: boolean }) {
    const response = this.entries.get(keyOf(request));
    // Как в браузере: `Vary: Origin` и другой Origin у запроса — промах.
    const varies = /origin/i.test(response?.headers.get('vary') ?? '');
    if (response && varies && !options?.ignoreVary) {
      if (this.origins.get(keyOf(request)) !== originOf(request)) return undefined;
    }
    return response?.clone();
  }
  async put(request: Request | string, response: Response) {
    this.origins.set(keyOf(request), originOf(request));
    this.entries.set(keyOf(request), response);
  }
  // Как в браузере: скачать и сохранить; сбой — отказ.
  async add(url: string) {
    const response = await this.network(new Request(new URL(url, ORIGIN)));
    if (!response.ok) throw new TypeError('bad status');
    this.entries.set(keyOf(url), response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: Request | string) {
    return this.entries.delete(keyOf(request));
  }
  paths() {
    return [...this.entries.keys()].map((url) => new URL(url).pathname);
  }
}

interface DisplayedNotification {
  tag?: string;
  close: ReturnType<typeof vi.fn>;
}

function loadWorker() {
  const listeners: Record<string, Listener> = {};
  const displayed: DisplayedNotification[] = [];
  const fetchMock: FetchMock = vi.fn<(request: Request) => Promise<Response>>();
  const stores = new Map<string, FakeCache>();
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache(fetchMock));
      return stores.get(name)!;
    },
    match: async (url: string, options?: { cacheName?: string }) =>
      stores.get(options?.cacheName ?? '')?.match(url),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, listener: Listener) => (listeners[type] = listener),
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async (): Promise<FakeWindow[]> => []),
      openWindow: vi.fn(async () => null),
    },
    registration: {
      // Показанные уведомления живут, пока их не закроют, — как в Центре
      // уведомлений.
      showNotification: vi.fn(async (_title: string, options?: { tag?: string }) => {
        const notification: DisplayedNotification = { tag: options?.tag, close: vi.fn() };
        notification.close.mockImplementation(() => {
          displayed.splice(displayed.indexOf(notification), 1);
        });
        displayed.push(notification);
      }),
      getNotifications: vi.fn(async (filter?: { tag?: string }) =>
        displayed.filter((notification) => !filter?.tag || notification.tag === filter.tag)
      ),
    } as {
      showNotification: ReturnType<typeof vi.fn>;
      getNotifications?: ReturnType<typeof vi.fn>;
      /** Уже работающий worker — значит, идёт обновление, а не первая установка. */
      active?: unknown;
    },
  };
  // Файл worker выполняется как есть; глобальные — поддельные.
  new Function('self', 'caches', 'fetch', 'BUILD_ID', 'PRECACHE_URLS', source)(
    self,
    caches,
    fetchMock,
    BUILD_ID,
    PRECACHE_URLS
  );

  /** Прогнать запрос через worker: ответ или null — не перехвачен. */
  async function dispatch(
    url: string,
    init: { mode?: string; method?: string; headers?: Record<string, string> } = {}
  ) {
    const request = new Request(new URL(url, ORIGIN), {
      method: init.method ?? 'GET',
      headers: init.headers,
    });
    Object.defineProperty(request, 'mode', { value: init.mode ?? 'cors' });
    let responded: Promise<Response> | null = null;
    listeners.fetch({ request, respondWith: (p: Promise<Response>) => (responded = p) });
    return responded ? await responded : null;
  }
  async function lifecycle(type: 'install' | 'activate') {
    let waited: Promise<unknown> = Promise.resolve();
    listeners[type]({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
  }
  /** Прислать push с таким содержимым. */
  async function push(data: unknown) {
    let waited: Promise<unknown> = Promise.resolve();
    listeners.push({
      data: { json: () => data },
      waitUntil: (p: Promise<unknown>) => (waited = p),
    });
    await waited;
  }
  /** Нажать на уведомление, открывающее url. */
  async function click(url: string) {
    let waited: Promise<unknown> = Promise.resolve();
    const notification = { data: { url }, close: vi.fn() };
    listeners.notificationclick({ notification, waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    return notification;
  }
  /** Сообщение от страницы. */
  function message(data: unknown) {
    listeners.message({ data });
  }
  return { dispatch, lifecycle, stores, fetchMock, self, push, click, displayed, message };
}

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } });

describe('service worker (#880)', () => {
  let worker: ReturnType<typeof loadWorker>;
  beforeEach(() => {
    worker = loadWorker();
  });

  it('API, сокет, медиа и чужие адреса не перехватываются и не кешируются', async () => {
    for (const url of [
      '/api/v2/messages/abc',
      '/api/v2/media/0b0c',
      '/api/v2/auth/login',
      '/ws',
      'https://fonts.googleapis.com/css2',
    ]) {
      expect(await worker.dispatch(url)).toBeNull();
    }
    expect(await worker.dispatch('/assets/index-abc.js', { method: 'POST' })).toBeNull();
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it('первая установка: оболочка и её файлы — заранее, worker включается сразу; не скачался один — остальные есть', async () => {
    worker.fetchMock.mockImplementation(async (request) =>
      request.url.endsWith('main-a.css')
        ? new Response('', { status: 404 })
        : request.url.endsWith('/index.html')
          ? html('shell')
          : new Response('file')
    );

    await worker.lifecycle('install');

    expect(worker.stores.get('craneapp-shell-test')!.paths()).toEqual(['/index.html']);
    expect(worker.stores.get('craneapp-assets-test')!.paths().sort()).toEqual([
      '/assets/main-a.js',
      '/locales/ru/translation.json',
    ]);
    expect(worker.self.skipWaiting).toHaveBeenCalled();
    for (const cache of worker.stores.values()) {
      expect(cache.paths().some((path) => path.startsWith('/api/'))).toBe(false);
    }
  });

  describe('обновление (#892)', () => {
    it('новая сборка поверх работающей ждёт «Обновить», а не включается сама', async () => {
      worker.fetchMock.mockResolvedValue(new Response('file'));
      worker.self.registration.active = {};

      await worker.lifecycle('install');
      expect(worker.self.skipWaiting).not.toHaveBeenCalled();

      worker.message({ type: 'craneapp:update' });
      expect(worker.self.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it('чужие сообщения worker не включают', () => {
      worker.message({ type: 'other' });
      worker.message(null);
      expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    });

    it('/version.json не перехватывается: версия — всегда с сервера', async () => {
      expect(await worker.dispatch('/version.json')).toBeNull();
      expect(worker.fetchMock).not.toHaveBeenCalled();
    });
  });

  it('файл, положенный при установке, находится и при Vary: Origin — иначе кусок прошлой сборки шёл бы в сеть', async () => {
    worker.fetchMock.mockImplementation(async (request) =>
      request.url.endsWith('/index.html')
        ? html('shell')
        : new Response('file-a', { headers: { vary: 'Origin' } })
    );
    await worker.lifecycle('install');
    worker.fetchMock.mockClear();

    // import() прошлой сборки — с Origin, а файла на сервере уже нет.
    worker.fetchMock.mockResolvedValue(html('app page'));
    const response = await worker.dispatch('/assets/main-a.js', { headers: { origin: ORIGIN } });

    expect(await response!.text()).toBe('file-a');
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it('навигация — сначала сеть: после деплоя сразу новая версия', async () => {
    worker.fetchMock.mockResolvedValueOnce(html('v2'));
    const response = await worker.dispatch('/chats/1', { mode: 'navigate' });

    expect(await response!.text()).toBe('v2');
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('без сети — последняя загруженная оболочка', async () => {
    worker.fetchMock.mockResolvedValueOnce(html('shell-v2'));
    await worker.dispatch('/', { mode: 'navigate' });

    worker.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const offline = await worker.dispatch('/chats/42', { mode: 'navigate' });
    expect(await offline!.text()).toBe('shell-v2');
  });

  it('в оболочку не попадает не-HTML и ошибки сервера', async () => {
    worker.fetchMock.mockResolvedValueOnce(html('good'));
    await worker.dispatch('/', { mode: 'navigate' });
    worker.fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }));
    await worker.dispatch('/', { mode: 'navigate' });
    worker.fetchMock.mockResolvedValueOnce(
      new Response('{}', { headers: { 'content-type': 'application/json' } })
    );
    await worker.dispatch('/', { mode: 'navigate' });

    worker.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const offline = await worker.dispatch('/', { mode: 'navigate' });
    expect(await offline!.text()).toBe('good');
  });

  it('отдельные страницы, документация и /mobile — как есть', async () => {
    for (const url of ['/server-down.html', '/docs/', '/mobile/x']) {
      expect(await worker.dispatch(url, { mode: 'navigate' })).toBeNull();
    }
  });

  it('файлы сборки, логотип и иконки — из кеша, в сеть только первый раз', async () => {
    for (const url of ['/assets/index-abc.js', '/logo.png', '/icons/icon-192.png']) {
      worker.fetchMock.mockResolvedValueOnce(new Response('file ' + url));
      await worker.dispatch(url);
      const second = await worker.dispatch(url);
      expect(await second!.text()).toBe('file ' + url);
    }
    expect(worker.fetchMock).toHaveBeenCalledTimes(3);
  });

  it('страница вместо файла сборки не кешируется под его именем', async () => {
    // Старый сервер отдавал index.html на любой отсутствующий путь.
    worker.fetchMock.mockResolvedValue(html('<html>app</html>'));
    await worker.dispatch('/assets/main-OLD.js');
    await worker.dispatch('/assets/main-OLD.js');

    expect(worker.fetchMock).toHaveBeenCalledTimes(2);
    for (const cache of worker.stores.values()) {
      expect(cache.paths()).not.toContain('/assets/main-OLD.js');
    }
  });

  it('переводы — сначала сеть (свежие после деплоя), без сети — из кеша', async () => {
    worker.fetchMock.mockResolvedValueOnce(new Response('{"a":"1"}'));
    await worker.dispatch('/locales/ru/translation.json');
    worker.fetchMock.mockResolvedValueOnce(new Response('{"a":"2"}'));
    const fresh = await worker.dispatch('/locales/ru/translation.json');
    expect(await fresh!.text()).toBe('{"a":"2"}');

    worker.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const offline = await worker.dispatch('/locales/ru/translation.json');
    expect(await offline!.text()).toBe('{"a":"2"}');
  });

  it('новая сборка удаляет кеши прежней, чужие не трогает', async () => {
    for (const name of [
      'craneapp-shell-old',
      'craneapp-assets-old',
      'craneapp-assets-test',
      'other-app',
    ]) {
      worker.stores.set(name, new FakeCache(worker.fetchMock));
    }

    await worker.lifecycle('activate');

    expect([...worker.stores.keys()].sort()).toEqual(['craneapp-assets-test', 'other-app']);
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  describe('push-уведомления (#882)', () => {
    const shown = () =>
      worker.self.registration.showNotification.mock.calls as unknown as [string, any][];

    it('личное сообщение: имя и «Новое сообщение», одно уведомление на чат', async () => {
      await worker.push({
        v: 1,
        kind: 'message',
        chatId: 'c1',
        chatType: 'private',
        actorName: 'Игорь',
        lang: 'ru',
      });

      const [title, options] = shown()[0];
      expect(title).toBe('Игорь');
      expect(options.body).toBe('Новое сообщение');
      expect(options.tag).toBe('chat:c1');
      expect(options.renotify).toBe(true);
      expect(options.data.url).toBe('/chats/c1');
    });

    it('группа: название группы, кто написал; язык получателя', async () => {
      await worker.push({
        v: 1,
        kind: 'message',
        chatId: 'g1',
        chatType: 'group',
        chatTitle: 'Команда',
        actorName: 'Oleg',
        lang: 'en',
      });
      const [title, options] = shown()[0];
      expect(title).toBe('Команда');
      expect(options.body).toBe('Oleg: New message');
    });

    it('входящий звонок держится на экране; пропущенный заменяет его тем же тегом', async () => {
      await worker.push({
        v: 1,
        kind: 'call',
        chatId: 'c1',
        chatType: 'private',
        actorName: 'Игорь',
        roomId: 'r1',
        callKind: 'video',
        lang: 'ru',
      });
      await worker.push({
        v: 1,
        kind: 'missed_call',
        chatId: 'c1',
        chatType: 'private',
        actorName: 'Игорь',
        roomId: 'r1',
        lang: 'ru',
      });

      const [[callTitle, call], [, missed]] = shown();
      expect(callTitle).toBe('Игорь');
      expect(call.body).toBe('Входящий видеозвонок');
      expect(call.requireInteraction).toBe(true);
      expect(missed.body).toBe('Пропущенный звонок');
      expect(missed.tag).toBe(call.tag);
      expect(missed.requireInteraction).toBe(false);
    });

    it('новое сообщение чата закрывает прежнее уведомление, а не заменяет: Safari заменяет молча', async () => {
      const message = (chatId: string) => ({
        v: 1,
        kind: 'message',
        chatId,
        chatType: 'private',
        actorName: 'Игорь',
        lang: 'ru',
      });
      await worker.push(message('c1'));
      await worker.push(message('c2'));
      const [first, other] = [...worker.displayed];

      await worker.push(message('c1'));

      // Закрыто до показа нового — тогда новое не замена и звучит.
      expect(first.close).toHaveBeenCalledTimes(1);
      const lastShow = worker.self.registration.showNotification.mock.invocationCallOrder.at(-1)!;
      expect(first.close.mock.invocationCallOrder[0]).toBeLessThan(lastShow);
      // Уведомление другого чата не трогается; на чат по-прежнему одно.
      expect(other.close).not.toHaveBeenCalled();
      expect(worker.displayed.map((notification) => notification.tag)).toEqual([
        'chat:c2',
        'chat:c1',
      ]);
    });

    it('пропущенный звонок сменяет входящий заменой, не закрывая его', async () => {
      const call = { v: 1, chatId: 'c1', chatType: 'private', actorName: 'Игорь', roomId: 'r1' };
      await worker.push({ ...call, kind: 'call', callKind: 'audio', lang: 'ru' });
      const [incoming] = worker.displayed;

      await worker.push({ ...call, kind: 'missed_call', lang: 'ru' });

      expect(incoming.close).not.toHaveBeenCalled();
    });

    it('браузер без getNotifications — уведомление всё равно показывается', async () => {
      delete worker.self.registration.getNotifications;
      await worker.push({ v: 1, kind: 'message', chatId: 'c1', chatType: 'private', lang: 'ru' });
      expect(shown()).toHaveLength(1);
    });

    it('пустой или битый push — всё равно уведомление: iOS иначе отберёт разрешение', async () => {
      await worker.push(undefined);
      expect(shown()).toHaveLength(1);
      expect(shown()[0][0]).toBe('CraneApp');
    });

    it('нажатие: открытое приложение — переход внутри него, без перезагрузки', async () => {
      const open: FakeWindow = {
        url: ORIGIN + '/chats',
        focus: vi.fn(async () => open),
        postMessage: vi.fn(),
      };
      worker.self.clients.matchAll.mockResolvedValueOnce([open]);

      const notification = await worker.click('/chats/c1');

      expect(notification.close).toHaveBeenCalled();
      expect(open.postMessage).toHaveBeenCalledWith({
        type: 'craneapp:navigate',
        url: '/chats/c1',
      });
      expect(open.focus).toHaveBeenCalled();
      expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
    });

    it('нажатие: приложение закрыто — новое окно на нужном чате', async () => {
      await worker.click('/chats/c1');
      expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/chats/c1');
    });
  });
});
