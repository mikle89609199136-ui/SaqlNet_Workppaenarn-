import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { STORAGE_KEYS } from '@/shared/config';
import { settingsQuery } from '@/entities/user';
import type { ISettingsDto } from '@/types';

/**
 * Применение темы и языка ко всему приложению.
 *
 * Источник — сервер: настройки лежат в кеше запросов, сюда они приходят
 * подпиской. Запрос отсюда не делается (`enabled: false`), потому что на
 * странице входа сессии ещё нет, а на защищённых страницах настройки уже
 * положил загрузчик.
 *
 * `localStorage` остаётся, но как проекция, а не второй источник правды:
 * пишется после того, как значение подтвердил сервер, а читается один раз —
 * скриптом в `index.html`, до первой отрисовки. Иначе при каждом запуске
 * экран мигал бы тёмной темой, пока грузится приложение.
 *
 * Раньше было наоборот: страница настроек сначала писала на диск, потом
 * отправляла запрос, и при ошибке диск расходился с сервером.
 */
export function useApplyPreferences(): void {
  // Экземпляр берётся из контекста, а не импортом глобального: так хук
  // работает с тем же i18n, что и остальное дерево, — включая тесты, где
  // экземпляр свой.
  const { i18n } = useTranslation();

  // Данные берутся из кеша: без подписки тема не сменилась бы до
  // перезагрузки, а с собственным запросом ушла бы к серверу без токена.
  const { data } = useQuery({ ...settingsQuery(), enabled: false });

  const theme = data?.settings?.theme;
  const language = data?.settings?.language;

  useEffect(() => {
    if (!theme) return;

    document.documentElement.setAttribute('data-theme', theme);
    writeProjection({ theme });
  }, [theme]);

  useEffect(() => {
    if (!language) return;

    document.documentElement.setAttribute('lang', language);
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
    writeProjection({ language });
  }, [i18n, language]);
}

/**
 * Проекция настроек на диск.
 *
 * Ключ тот же, что читает `getPreferredLanguage` в переводчике сообщений,
 * поэтому пишется слиянием: перезапись целиком стёрла бы соседнее поле.
 */
function writeProjection(patch: Partial<ISettingsDto>): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    // Пустой объект, а не набор умолчаний: проекция хранит только то, что
    // нужно до загрузки настроек. Полный снимок здесь притворялся бы
    // состоянием настроек и расходился бы с сервером по остальным полям.
    const current = raw ? JSON.parse(raw) : {};
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Приватный режим или переполненное хранилище: проекция — удобство,
    // а не условие работы. Значение уже применено к документу.
  }
}
