import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadOnStaleBuild, requestPersistentStorage } from './resilience';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const preloadError = () => {
  const event = new Event('vite:preloadError', { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

/* Открытая вкладка после деплоя (#880). */
describe('перезагрузка при устаревшей сборке', () => {
  let stop: () => void = () => undefined;
  afterEach(() => stop());

  it('ошибка загрузки файла сборки — перезагрузка, ошибка не всплывает', () => {
    const reload = vi.fn();
    stop = reloadOnStaleBuild({ now: () => 1_000_000, reload, storage: memoryStorage() });

    const event = preloadError();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('второй раз подряд — не перезагружается: ошибка идёт дальше, петли нет', () => {
    const reload = vi.fn();
    let now = 1_000_000;
    const storage = memoryStorage();
    stop = reloadOnStaleBuild({ now: () => now, reload, storage });

    preloadError();
    now += 3_000;
    const second = preloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);

    // Спустя время — снова можно (новый деплой).
    now += 60_000;
    preloadError();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

/* Ключи шифрования не должны исчезать при нехватке места (#880). */
describe('постоянное хранилище', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0';

  it('просит, если ещё не постоянное', async () => {
    const storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => true) };
    expect(await requestPersistentStorage({ userAgent: chrome, storage })).toBe(true);
    expect(storage.persist).toHaveBeenCalled();
  });

  it('уже постоянное — не просит', async () => {
    const storage = { persisted: vi.fn(async () => true), persist: vi.fn(async () => true) };
    expect(await requestPersistentStorage({ userAgent: chrome, storage })).toBe(true);
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it('Firefox спрашивает окном — при загрузке не просим', async () => {
    const storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => true) };
    const firefox = 'Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0';
    expect(await requestPersistentStorage({ userAgent: firefox, storage })).toBe(false);
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it('нет API или ошибка — без исключения', async () => {
    expect(await requestPersistentStorage({ userAgent: chrome, storage: undefined })).toBe(false);
    const broken = {
      persisted: vi.fn(async () => Promise.reject(new Error('x'))),
      persist: vi.fn(),
    };
    expect(await requestPersistentStorage({ userAgent: chrome, storage: broken })).toBe(false);
  });
});
