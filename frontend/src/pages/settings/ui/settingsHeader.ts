import type { TFunction } from 'i18next';
import {
  ROUTES,
  isAccountSubsection,
  isPrivacySubsection,
  isSettingsSection,
  type TAccountSubsection,
  type TPrivacySubsection,
  type TSettingsSection,
} from '@/shared/config/routes';

/* Названия разделов — в меню и в шапке одинаковые, как в макете. */
export const SECTION_TITLES: Record<TSettingsSection, readonly [string, string]> = {
  account: ['settings.account.title', 'Аккаунт'],
  notifications: ['settings.notifications.title', 'Уведомления и звуки'],
  appearance: ['settings.appearance.title', 'Внешний вид'],
  privacy: ['settings.privacy.title', 'Конфиденциальность'],
  language: ['settings.language.title', 'Язык'],
  about: ['settings.about.title', 'О приложении'],
};

const ACCOUNT_TITLES: Record<TAccountSubsection, readonly [string, string]> = {
  me: ['settings.me.title', 'Мой профиль'],
  profile: ['settings.profile.title', 'Изменить профиль'],
  email: ['settings.account.email', 'Электронная почта'],
  password: ['settings.account.password', 'Пароль'],
  sessions: ['settings.account.sessions', 'Активные сеансы'],
  encryption: ['keyBackup.settings.title', 'Шифрование и устройства'],
};

const PRIVACY_TITLES: Record<TPrivacySubsection, readonly [string, string]> = {
  'last-seen': ['settings.privacy.lastSeen', 'Последняя активность'],
  photo: ['settings.privacy.photo', 'Фото профиля'],
  forwards: ['settings.privacy.forwards', 'Пересылка сообщений'],
  blocked: ['settings.privacy.blocked', 'Чёрный список'],
};

export interface ISettingsHeader {
  title: string;
  /** Куда ведёт «назад» в шапке; нет — кнопки нет (раздел на ПК). */
  backTo?: string;
  backLabel?: string;
}

/**
 * Шапка правой панели по адресу: раздел — его название; подстраница —
 * её название и «назад» к разделу. На телефоне у раздела ещё «назад» к
 * меню — меню и раздел там разные экраны.
 */
export function settingsHeader(
  t: TFunction,
  section: string | undefined,
  subsection: string | undefined,
  isPhone: boolean
): ISettingsHeader {
  if (!isSettingsSection(section)) return { title: t('settings.menu.title', 'Настройки') };
  const sectionTitle = t(...SECTION_TITLES[section]);

  const subTitle =
    section === 'account' && isAccountSubsection(subsection)
      ? ACCOUNT_TITLES[subsection]
      : section === 'privacy' && isPrivacySubsection(subsection)
        ? PRIVACY_TITLES[subsection]
        : null;

  if (subTitle) {
    return {
      title: t(...subTitle),
      backTo: ROUTES.SETTINGS_SECTION(section),
      backLabel: t('settings.backTo', { defaultValue: 'Назад: {{title}}', title: sectionTitle }),
    };
  }

  return isPhone
    ? {
        title: sectionTitle,
        backTo: ROUTES.SETTINGS,
        backLabel: t('settings.backToMenu', 'Назад к настройкам'),
      }
    : { title: sectionTitle };
}
