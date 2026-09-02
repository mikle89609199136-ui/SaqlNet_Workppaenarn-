export const REACT_ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: 'register',
  CHATS: '/chats',
  CHAT_BY_ID: '/chats/:chatId',
  CONTACTS: '/contacts',
  SETTINGS: '/settings',
  /* Раздел настроек живёт в адресе, а не в состоянии: иначе на него нельзя
     дать ссылку, перезагрузка возвращает к первому разделу, а «назад» в
     браузере уводит со всей страницы вместо предыдущего раздела. */
  SETTINGS_SECTION: ':section',
  SETTINGS_SUBSECTION: ':section/:subsection',
};

/* Разделы настроек. Список закрытый: по нему строится меню и проверяется
   адрес — неизвестный раздел ведёт на первый, а не на пустой экран. */
export const SETTINGS_SECTIONS = [
  'account',
  'notifications',
  'appearance',
  'privacy',
  'language',
  'about',
] as const;

export type TSettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SETTINGS_SECTION: TSettingsSection = 'account';

/* Подстраницы аккаунта — второй уровень: /settings/account/password. */
export const ACCOUNT_SUBSECTIONS = ['profile', 'email', 'password', 'sessions'] as const;

export type TAccountSubsection = (typeof ACCOUNT_SUBSECTIONS)[number];

export function isSettingsSection(value: string | undefined): value is TSettingsSection {
  return SETTINGS_SECTIONS.includes(value as TSettingsSection);
}

export function isAccountSubsection(value: string | undefined): value is TAccountSubsection {
  return ACCOUNT_SUBSECTIONS.includes(value as TAccountSubsection);
}

class Routes {
  HOME = '/';

  CHATS = '/chats';
  CHAT_BY_ID = (chatId: string) => `/chats/${encodeURIComponent(chatId)}`;

  SETTINGS = '/settings';
  SETTINGS_SECTION = (section: string) => `/settings/${section}`;
  SETTINGS_SUBSECTION = (section: string, subsection: string) =>
    `/settings/${section}/${subsection}`;

  LOGIN = '/login';
  REGISTER = '/register';
  MENU = '/menu';
  CHANNELS = '/channels';
  COMMUNITIES = '/communities';
  MEETINGS = '/meetings';
}

export const ROUTES = new Routes();
