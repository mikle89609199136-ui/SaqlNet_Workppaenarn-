import { ROUTES } from '@/shared/config';
import type { TIconTypes } from '@/shared/types';

export interface INavItem {
  key: string;
  label: string;
  path: string;
  icon: TIconTypes;
  /** Показывать только в нижней панели телефона. */
  mobileOnly?: boolean;
}

/**
 * Разделы приложения — один список на обе панели.
 *
 * Различаются панели не составом, а тем, что телефону нужен вход в
 * настройки: на широких экранах он есть внизу рельса, отдельным местом,
 * и дублировать его в общем списке незачем.
 */
export const navItems: INavItem[] = [
  { key: 'chats', label: 'Чаты', path: ROUTES.CHATS, icon: 'chat' },
  { key: 'channels', label: 'Каналы', path: ROUTES.CHANNELS, icon: 'channel' },
  { key: 'communities', label: 'Сообщества', path: ROUTES.COMMUNITIES, icon: 'users' },
  { key: 'meetings', label: 'Встречи', path: ROUTES.MEETINGS, icon: 'video' },
  /* На телефоне это единственный вход в настройки: там нет ни бокового
     рельса, ни бургера, и до `/settings` нельзя было добраться вовсе —
     только набрав адрес руками. */
  {
    key: 'settings',
    label: 'Настройки',
    path: ROUTES.SETTINGS,
    icon: 'settings',
    mobileOnly: true,
  },
];

/** Пункты бокового рельса: всё, кроме того, что предназначено телефону. */
export const sideNavItems = navItems.filter((item) => !item.mobileOnly);
