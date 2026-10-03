import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, syncThemeColor } from './pwa';

/* Регистрация worker и цвет строки состояния (#880). */
describe('PWA', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--color-ground');
  });

  it('worker регистрируется только в продакшен-сборке', async () => {
    const register = vi.fn(async () => ({}) as ServiceWorkerRegistration);
    const nav = { serviceWorker: { register } } as unknown as Navigator;

    await registerServiceWorker({ isProduction: false, navigator: nav });
    expect(register).not.toHaveBeenCalled();

    await registerServiceWorker({ isProduction: true, navigator: nav });
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('без поддержки или при ошибке — обычная страница, без исключений', async () => {
    await expect(
      registerServiceWorker({ isProduction: true, navigator: {} as Navigator })
    ).resolves.toBeUndefined();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const register = vi.fn(async () => {
      throw new Error('SecurityError');
    });
    await expect(
      registerServiceWorker({
        isProduction: true,
        navigator: { serviceWorker: { register } } as unknown as Navigator,
      })
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('цвет строки состояния следует за темой', async () => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000">';
    const root = document.documentElement;
    root.style.setProperty('--color-ground', '#0f1216');
    const stop = syncThemeColor(root);
    const meta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content;
    expect(meta()).toBe('#0f1216');

    root.style.setProperty('--color-ground', '#e4e9f1');
    root.setAttribute('data-theme', 'light');
    await vi.waitFor(() => expect(meta()).toBe('#e4e9f1'));
    stop();
  });
});
