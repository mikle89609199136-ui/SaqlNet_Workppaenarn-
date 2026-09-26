import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';
import { SETTINGS_SECTIONS, type TSettingsSection } from '@/shared/config/routes';

/**
 * Разделы настроек — по маршруту на каждый.
 *
 * Сборщику нужно видеть каждый путь, иначе разделы не разъедутся по отдельным частям.
 */
const SECTION_COMPONENTS: Record<TSettingsSection, () => Promise<{ Component: ComponentType }>> = {
  account: () =>
    import('./ui/sections/AccountSection').then((m) => ({
      Component: m.AccountSection,
    })),
  notifications: () =>
    import('./ui/sections/NotificationsSection').then((m) => ({
      Component: m.NotificationsSection,
    })),
  appearance: () =>
    import('./ui/sections/AppearanceSection').then((m) => ({
      Component: m.AppearanceSection,
    })),
  privacy: () =>
    import('./ui/sections/PrivacySection').then((m) => ({
      Component: m.PrivacySection,
    })),
  language: () =>
    import('./ui/sections/LanguageSection').then((m) => ({
      Component: m.LanguageSection,
    })),
  about: () =>
    import('./ui/sections/AboutSection').then((m) => ({
      Component: m.AboutSection,
    })),
};

/* Подстраницы есть у аккаунта и конфиденциальности, разбирает их сам раздел. */
const WITH_SUBSECTIONS: TSettingsSection[] = ['account', 'privacy'];

export const settingsSectionRoutes: RouteObject[] = SETTINGS_SECTIONS.flatMap((section) => {
  const lazy = SECTION_COMPONENTS[section];
  const route: RouteObject = { path: section, lazy };

  return WITH_SUBSECTIONS.includes(section)
    ? [route, { path: `${section}/:subsection`, lazy }]
    : [route];
});
