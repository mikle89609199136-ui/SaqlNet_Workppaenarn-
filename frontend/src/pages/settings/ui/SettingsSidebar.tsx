import type { TFunction } from 'i18next';
import { SETTINGS_SECTIONS, type TSettingsSection } from '@/shared/config/routes';
import type { TIconTypes } from '@/shared/types';
import { SettingsMenuItem } from './SettingsMenuItem';

/* Порядок пунктов задаётся списком разделов, значок и подпись — здесь.
   Ключи меню отдельные от заголовков разделов: в меню «Уведомления», а
   заголовком — «Уведомления и звуки», и подписи должны быть короче.
   Список один на меню и на проверку адреса: раздела, которого в нём нет,
   не существует и для маршрута. */
const SECTION_VIEW: Record<TSettingsSection, { icon: TIconTypes; fallback: string; key: string }> =
  {
    account: { icon: 'user', fallback: 'Аккаунт', key: 'settings.menu.account' },
    notifications: { icon: 'bell', fallback: 'Уведомления', key: 'settings.menu.notifications' },
    appearance: { icon: 'palette', fallback: 'Внешний вид', key: 'settings.menu.appearance' },
    privacy: { icon: 'lock', fallback: 'Конфиденциальность', key: 'settings.menu.privacy' },
    language: { icon: 'language', fallback: 'Язык', key: 'settings.menu.language' },
    about: { icon: 'info', fallback: 'О приложении', key: 'settings.menu.about' },
  };

interface Props {
  t?: TFunction;
}

export function SettingsSidebar({ t }: Props) {
  return (
    <aside className="flex min-h-0 flex-1 flex-col pb-4">
      <div className="flex items-center gap-2.5 px-8 pt-2 pb-5">
        <h2 className="text-body font-bold text-ink">
          {t ? t('settings.menu.title', 'Настройки') : 'Настройки'}
        </h2>
      </div>

      {/* На узком экране меню ложится в строку и прокручивается вбок:
          вертикальный список занял бы весь экран до содержимого. */}
      <nav className="flex flex-row overflow-x-auto md:flex-col md:overflow-x-visible md:overflow-y-auto">
        {SETTINGS_SECTIONS.map((section) => {
          const view = SECTION_VIEW[section];
          return (
            <SettingsMenuItem
              icon={view.icon}
              key={section}
              label={t ? t(view.key, view.fallback) : view.fallback}
              section={section}
            />
          );
        })}
      </nav>
    </aside>
  );
}
