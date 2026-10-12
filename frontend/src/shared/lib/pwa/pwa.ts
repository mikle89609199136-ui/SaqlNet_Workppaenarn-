/**
 * PWA (#880): установка на экран «Домой».
 *
 * Service worker — `public/sw.js`: оболочка и файлы сборки, без данных.
 * Регистрируется только в продакшен-сборке: в разработке vite отдаёт
 * модули напрямую, и кеш только мешал бы.
 */

interface IServiceWorkerEnv {
  isProduction: boolean;
  navigator: Pick<Navigator, 'serviceWorker'> | undefined;
}

const browserEnv = (): IServiceWorkerEnv => ({
  isProduction: import.meta.env.PROD,
  navigator: typeof navigator === 'undefined' ? undefined : navigator,
});

export async function registerServiceWorker(env: IServiceWorkerEnv = browserEnv()): Promise<void> {
  const container = env.navigator?.serviceWorker;
  if (!env.isProduction || !container) return;
  try {
    await container.register('/sw.js', { scope: '/' });
  } catch (error) {
    // Без worker приложение работает как обычная страница.
    console.warn('Service worker не зарегистрирован', error);
  }
}

/**
 * Цвет строки состояния (Android, установленное приложение) — фон текущей
 * темы и палитры. Тему выбирает человек, а не система, поэтому цвет
 * следит за атрибутами `<html>`, а не за `prefers-color-scheme`.
 */
export function syncThemeColor(root: HTMLElement = document.documentElement): () => void {
  const apply = () => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const ground = getComputedStyle(root).getPropertyValue('--color-ground').trim();
    if (meta && ground) meta.content = ground;
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
  return () => observer.disconnect();
}
