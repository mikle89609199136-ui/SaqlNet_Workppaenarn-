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
type FetchMock = ReturnType<typeof vi.fn<(request: Request) => Promise<Response>>>;

const keyOf = (request: Request | string) =>
  typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;

class FakeCache {
  entries = new Map<string, Response>();
  private readonly network: FetchMock;
  constructor(network: FetchMock) {
    this.network = network;
  }
  async match(request: Request | string) {
    return this.entries.get(keyOf(request))?.clone();
  }
  async put(request: Request | string, response: Response) {
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

function loadWorker() {
  const listeners: Record<string, Listener> = {};
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
    clients: { claim: vi.fn(async () => undefined) },
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
  async function dispatch(url: string, init: { mode?: string; method?: string } = {}) {
    const request = new Request(new URL(url, ORIGIN), { method: init.method ?? 'GET' });
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
  return { dispatch, lifecycle, stores, fetchMock, self };
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

  it('установка: оболочка и её файлы — заранее; не скачался один — остальные есть', async () => {
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
    for (const url of ['/call.html', '/server-down.html', '/docs/', '/mobile/x']) {
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
});
