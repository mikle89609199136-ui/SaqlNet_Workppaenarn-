/**
 * Надёжность установленного приложения (#880).
 */

const STALE_RELOAD_KEY = 'craneapp_stale_build_reload_at';
/** Второй раз подряд за это время не перезагружаемся: значит, дело не в версии. */
const STALE_RELOAD_WINDOW_MS = 10_000;

interface IStaleBuildEnv {
  now: () => number;
  reload: () => void;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const browserStaleEnv = (): IStaleBuildEnv => ({
  now: () => Date.now(),
  reload: () => window.location.reload(),
  storage: (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })(),
});

/**
 * Открытая вкладка после деплоя: её код — прошлой версии, а файлов прошлой
 * версии на сервере уже нет. Первый же переход на ещё не открывавшийся
 * экран падал бы с ошибкой загрузки. Vite сообщает о такой ошибке событием
 * `vite:preloadError` — тогда страница перезагружается и получает новую
 * версию. Защита от петли: второй раз за десять секунд — не
 * перезагружаемся, ошибка идёт дальше, к обработчику маршрута.
 */
export function reloadOnStaleBuild(env: IStaleBuildEnv = browserStaleEnv()): () => void {
  const onPreloadError = (event: Event) => {
    const last = Number(env.storage?.getItem(STALE_RELOAD_KEY) ?? 0);
    if (env.now() - last < STALE_RELOAD_WINDOW_MS) return;
    try {
      env.storage?.setItem(STALE_RELOAD_KEY, String(env.now()));
    } catch {
      // без хранилища — защита от петли слабее, но перезагрузка нужна
    }
    event.preventDefault();
    env.reload();
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}

interface IStorageEnv {
  userAgent: string;
  storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined;
}

/**
 * Ключи шифрования живут в хранилище браузера (IndexedDB), а браузер при
 * нехватке места вправе его очистить — вместе с ключами. Постоянное
 * хранилище браузер без спроса не чистит. Chrome и Safari решают сами,
 * без вопросов человеку; Firefox спрашивает окном — там не просим при
 * загрузке, чтобы не пугать.
 */
export async function requestPersistentStorage(
  env: IStorageEnv = {
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    storage: typeof navigator === 'undefined' ? undefined : navigator.storage,
  }
): Promise<boolean> {
  if (!env.storage?.persist || /Firefox\//.test(env.userAgent)) return false;
  try {
    if (await env.storage.persisted()) return true;
    return await env.storage.persist();
  } catch {
    return false;
  }
}
