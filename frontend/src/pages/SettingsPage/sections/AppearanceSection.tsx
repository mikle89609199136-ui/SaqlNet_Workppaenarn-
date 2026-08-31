import { Avatar, SegmentedControl } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { meQuery } from '@/queries/users/meQuery';
import type { ISettingsDto } from '@/types';
import { SettingsRow, SettingsSection } from '../SettingsControls';
import { useSettingsData } from './useSettingsData';

/* Вариантов два, и оба задаются атрибутом data-theme. Режима «как в
   системе» нет — см. шапку styles/tokens/themes.css. */
const THEME_OPTIONS = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
];

/* Буква и сетка — вкусовой выбор, поэтому он отдан человеку, а не решён
   в переписке (#375). Рядом показан образец: по названиям вариантов
   понять, что получится, нельзя. */
const AVATAR_SHAPE_OPTIONS = [
  { value: 'letter', label: 'Буква' },
  { value: 'grid', label: 'Сетка' },
];

function isTheme(value: string): value is ISettingsDto['theme'] {
  return THEME_OPTIONS.some((option) => option.value === value);
}

function isAvatarShape(value: string): value is ISettingsDto['avatarShape'] {
  return AVATAR_SHAPE_OPTIONS.some((option) => option.value === value);
}

export function AppearanceSection() {
  const { settings, saveSettings } = useSettingsData();
  const { data: user } = useQuery(meQuery());

  return (
    <SettingsSection description="Тема оформления и вид аватарок." title="Внешний вид">
      {/* Два значения видны сразу: прятать выбор из двух за раскрытием
          списка — лишнее нажатие на пустом месте. */}
      <SettingsRow label="Тема">
        <SegmentedControl
          aria-label="Тема"
          onChange={(value) => isTheme(value) && saveSettings({ theme: value })}
          options={THEME_OPTIONS}
          value={settings.theme}
        />
      </SettingsRow>

      <SettingsRow
        description="Чем заменить фотографию, если её нет"
        label="Аватарка без фотографии"
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
            aria-label="Аватарка без фотографии"
            onChange={(value) => isAvatarShape(value) && saveSettings({ avatarShape: value })}
            options={AVATAR_SHAPE_OPTIONS}
            value={settings.avatarShape}
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
