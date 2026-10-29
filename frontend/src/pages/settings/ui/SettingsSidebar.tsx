import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { meQuery } from '@/entities/user';
import { ROUTES, SETTINGS_SECTIONS, type TSettingsSection } from '@/shared/config/routes';
import { Avatar, Icon } from '@/shared/ui';
import type { TIconTypes } from '@/types';
import { SECTION_TITLES } from './settingsHeader';
import { SettingsMenuItem } from './SettingsMenuItem';
import { SettingsSearch } from './SettingsSearch';

/* Порядок пунктов задаётся списком разделов, значок — здесь, подпись —
   та же, что в шапке раздела, как в макете. */
const SECTION_ICONS: Record<TSettingsSection, TIconTypes> = {
  account: 'user',
  notifications: 'bell',
  appearance: 'palette',
  privacy: 'lock',
  language: 'language',
  about: 'info',
};

/**
 * Меню настроек — по макету (#828): «назад» к чатам и заголовок, карточка
 * своего профиля, поиск и разделы. На телефоне — отдельный экран.
 */
export function SettingsSidebar() {
  const { t } = useTranslation();
  const { data: me } = useQuery(meQuery());
  const name = [me?.firstName, me?.lastName].filter(Boolean).join(' ') || me?.username || '';

  return (
    <>
      <div className="flex h-16 shrink-0 items-center pr-4 pl-2.5">
        {/* Назад к чатам: прежде туда вела боковая панель, которой больше
            нет (#818). Как в макете — стрелка цветом акцента, вся плашка
            кликабельна на всю ширину (#1083). */}
        <Link
          aria-label={`${t('backToChats', 'Назад к чатам')}: ${t('settings.menu.title', 'Настройки')}`}
          className="flex h-11 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-button text-ink hover:layer-hover active:layer-press focus-visible:outline-2 focus-visible:outline-brand"
          to={ROUTES.CHATS}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-icon text-brand">
            <Icon className="size-5.5 stroke-2" name="chevronLeft" />
          </span>
          <h1 className="m-0 truncate text-section font-semibold tracking-[-0.01em]">
            {t('settings.menu.title', 'Настройки')}
          </h1>
        </Link>
      </div>

      {/* Свой профиль — так, как его видят другие (#828). */}
      <Link
        className="mx-3 mb-3 flex items-center gap-3.5 rounded-bubble bg-sheet-2 p-3 text-left hover:layer-hover focus-visible:outline-2 focus-visible:outline-brand"
        to={ROUTES.SETTINGS_SUBSECTION('account', 'me')}
      >
        <Avatar id={me?.id} name={me?.firstName || me?.username} size="menu" src={me?.avatarUrl} />
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="truncate text-subtitle font-semibold text-ink">{name}</span>
          {me?.username && <span className="text-caption text-ink-3">@{me.username}</span>}
        </span>
        <Icon
          aria-hidden="true"
          className="size-4.5 shrink-0 stroke-2 text-ink-3"
          name="chevronRight"
        />
      </Link>

      <SettingsSearch />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-3 [scrollbar-width:thin]">
        {SETTINGS_SECTIONS.map((section) => (
          <SettingsMenuItem
            icon={SECTION_ICONS[section]}
            key={section}
            label={t(...SECTION_TITLES[section])}
            section={section}
          />
        ))}
      </div>
    </>
  );
}
