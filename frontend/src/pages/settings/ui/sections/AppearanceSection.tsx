import { Avatar, SegmentedControl } from '@/shared/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { meQuery } from '@/entities/user';
import type { ISettingsDto } from '@/types';
import { SettingsRow, SettingsSection } from '../SettingsControls';
import { useSettingsData } from './useSettingsData';

/* Вариантов два, и оба задаются атрибутом data-theme. Режима «как в
   системе» нет — см. шапку styles/tokens/themes.css. */
const THEME_VALUES = ['dark', 'light'] as const;

/* Буква и сетка — вкусовой выбор, поэтому он отдан человеку, а не решён
   в переписке (#375). Рядом показан образец: по названиям вариантов
   понять, что получится, нельзя. */
const AVATAR_SHAPE_VALUES = ['letter', 'grid'] as const;

function isTheme(value: string): value is ISettingsDto['theme'] {
  return (THEME_VALUES as readonly string[]).includes(value);
}

function isAvatarShape(value: string): value is ISettingsDto['avatarShape'] {
  return (AVATAR_SHAPE_VALUES as readonly string[]).includes(value);
}

export function AppearanceSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useSettingsData();

  /* Подписи вариантов переводятся, значения — нет: значение уходит на
     сервер и от языка не зависит. */
  const themeOptions = [
    { value: 'dark', label: t('settings.appearance.themeDark', 'Тёмная') },
    { value: 'light', label: t('settings.appearance.themeLight', 'Светлая') },
  ];
  const avatarShapeOptions = [
    { value: 'letter', label: t('settings.appearance.avatarLetter', 'Буква') },
    { value: 'grid', label: t('settings.appearance.avatarGrid', 'Сетка') },
  ];
  const { data: user } = useQuery(meQuery());

  return (
    <SettingsSection
      description={t('settings.appearance.description', 'Тема оформления и вид аватарок.')}
      title={t('settings.appearance.title', 'Внешний вид')}
    >
      {/* Два значения видны сразу: прятать выбор из двух за раскрытием
          списка — лишнее нажатие на пустом месте. */}
      <SettingsRow label={t('settings.appearance.theme', 'Тема')}>
        <SegmentedControl
          aria-label={t('settings.appearance.theme', 'Тема')}
          onChange={(value) => isTheme(value) && saveSettings({ theme: value })}
          options={themeOptions}
          value={settings.theme}
        />
      </SettingsRow>

      <SettingsRow
        description={t('settings.appearance.avatarHint', 'Чем заменить фотографию, если её нет')}
        label={t('settings.appearance.avatar', 'Аватарка без фотографии')}
      >
        <div className="flex items-center gap-3">
          {/* Вид передан пропом, а не взят из настройки: это образец
              выбранного значения, и он обязан показывать то, что выбрано
              прямо сейчас — даже пока ответ сервера не пришёл. */}
          <Avatar
            id={user?.id}
            name={user?.firstName || user?.username}
            shape={settings.avatarShape}
            size="md"
          />
          <SegmentedControl
            aria-label={t('settings.appearance.avatar', 'Аватарка без фотографии')}
            onChange={(value) => isAvatarShape(value) && saveSettings({ avatarShape: value })}
            options={avatarShapeOptions}
            value={settings.avatarShape}
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
