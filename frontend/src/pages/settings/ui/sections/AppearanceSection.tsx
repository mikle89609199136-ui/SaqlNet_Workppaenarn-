import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACCENTS,
  meQuery,
  PALETTES,
  useAppearanceStore,
  type TAccent,
  type TPalette,
} from '@/entities/user';
import { cn } from '@/shared/lib';
import { Avatar, Icon } from '@/shared/ui';
import type { ISettingsDto } from '@/types';
import { useSettingsData } from './useSettingsData';

/*
 * «Внешний вид» по макету (#828): тема, палитра фона, цвет акцента и вид
 * аватарки без фото. Всё выбирается карточками с образцом — по названию
 * варианта не понять, что получится, — и применяется сразу.
 *
 * Тема и аватарка хранятся на сервере, палитра и акцент — пока только в
 * браузере (#728), см. appearanceStore.
 */

/* Вариантов темы два, и оба задаются атрибутом data-theme. Режима «как в
   системе» нет — см. шапку styles/tokens/themes.css. */
const THEMES = ['dark', 'light'] as const satisfies readonly ISettingsDto['theme'][];

/* Буква и сетка — вкусовой выбор, поэтому он отдан человеку, а не решён
   в переписке (#375). */
const AVATAR_SHAPES = ['letter', 'grid'] as const satisfies readonly ISettingsDto['avatarShape'][];

export function AppearanceSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useSettingsData();
  const { data: user } = useQuery(meQuery());
  const { palette, accent, setPalette, setAccent } = useAppearanceStore();

  const themeLabels: Record<ISettingsDto['theme'], string> = {
    dark: t('settings.appearance.themeDark', 'Тёмная'),
    light: t('settings.appearance.themeLight', 'Светлая'),
  };
  const paletteLabels: Record<TPalette, string> = {
    graphite: t('settings.appearance.paletteGraphite', 'Графит'),
    midnight: t('settings.appearance.paletteMidnight', 'Полночь'),
    warm: t('settings.appearance.paletteWarm', 'Тёплая'),
  };
  const accentLabels: Record<TAccent, string> = {
    violet: t('settings.appearance.accentViolet', 'Фиолетовый'),
    plum: t('settings.appearance.accentPlum', 'Сливовый'),
    orchid: t('settings.appearance.accentOrchid', 'Орхидея'),
    indigo: t('settings.appearance.accentIndigo', 'Индиго'),
    amber: t('settings.appearance.accentAmber', 'Янтарный'),
    teal: t('settings.appearance.accentTeal', 'Бирюзовый'),
  };
  const avatarLabels: Record<ISettingsDto['avatarShape'], [string, string]> = {
    letter: [
      t('settings.appearance.avatarLetter', 'Буква'),
      t('settings.appearance.avatarLetterHint', 'Первая буква имени'),
    ],
    grid: [
      t('settings.appearance.avatarGrid', 'Сетка'),
      t('settings.appearance.avatarGridHint', 'Узор из имени'),
    ],
  };

  return (
    <>
      <PickerGroup className="grid-cols-2" title={t('settings.appearance.theme', 'Тема')}>
        {THEMES.map((theme) => (
          <PickerCard
            checked={settings.theme === theme}
            key={theme}
            label={themeLabels[theme]}
            onSelect={() => settings.theme !== theme && saveSettings({ theme })}
          >
            <ThemePreview preview={`${palette}-${theme}`} />
          </PickerCard>
        ))}
      </PickerGroup>

      <PickerGroup className="grid-cols-3" title={t('settings.appearance.palette', 'Палитра')}>
        {PALETTES.map((option) => (
          <PickerCard
            checked={palette === option}
            key={option}
            label={paletteLabels[option]}
            onSelect={() => setPalette(option)}
          >
            <PaletteSwatches preview={`${option}-${settings.theme}`} />
          </PickerCard>
        ))}
      </PickerGroup>

      <section
        aria-label={t('settings.appearance.accent', 'Цвет акцента')}
        className="flex flex-col gap-2.5"
      >
        <GroupTitle>{t('settings.appearance.accent', 'Цвет акцента')}</GroupTitle>
        <div
          aria-label={t('settings.appearance.accent', 'Цвет акцента')}
          className="flex flex-wrap gap-3 rounded-dialog bg-card p-4"
          role="radiogroup"
        >
          {ACCENTS.map((option) => {
            const checked = accent === option;
            return (
              /* Цвет берётся из набора самого акцента: data-accent на
                 кружке переопределяет --brand-fill только для него. */
              <button
                aria-checked={checked}
                aria-label={accentLabels[option]}
                className={cn(
                  'flex size-11 cursor-pointer items-center justify-center rounded-pill bg-(--brand-fill) text-(--on-brand) transition-shadow duration-[160ms]',
                  'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand',
                  checked && 'shadow-[0_0_0_3px_var(--color-card),0_0_0_5px_var(--brand-fill)]'
                )}
                data-accent={option}
                key={option}
                onClick={() => setAccent(option)}
                role="radio"
                title={accentLabels[option]}
                type="button"
              >
                {checked && <Icon className="size-3.5 stroke-3" name="check" />}
              </button>
            );
          })}
        </div>
      </section>

      <PickerGroup
        className="grid-cols-2"
        title={t('settings.appearance.avatar', 'Аватарка без фотографии')}
      >
        {AVATAR_SHAPES.map((shape) => (
          <PickerCard
            checked={settings.avatarShape === shape}
            hint={avatarLabels[shape][1]}
            horizontal
            key={shape}
            label={avatarLabels[shape][0]}
            onSelect={() => settings.avatarShape !== shape && saveSettings({ avatarShape: shape })}
          >
            {/* Вид передан пропом, а не взят из настройки: это образец
                варианта, и он показывает именно его. */}
            <Avatar
              id={user?.id}
              name={user?.firstName || user?.username}
              shape={shape}
              size="sample"
            />
          </PickerCard>
        ))}
      </PickerGroup>
    </>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mx-1 my-0 text-caption font-semibold tracking-[0.04em] text-ink-3 uppercase">
      {children}
    </h3>
  );
}

function PickerGroup({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <GroupTitle>{title}</GroupTitle>
      <div aria-label={title} className={cn('grid gap-3', className)} role="radiogroup">
        {children}
      </div>
    </section>
  );
}

interface PickerCardProps {
  checked: boolean;
  label: string;
  hint?: string;
  /** Образец слева от подписи, а не над ней — у аватарок. */
  horizontal?: boolean;
  onSelect: () => void;
  children: ReactNode;
}

/** Карточка варианта: образец и подпись, выбранная — в кольце акцента. */
function PickerCard({ checked, label, hint, horizontal, onSelect, children }: PickerCardProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        'flex min-w-0 cursor-pointer rounded-bubble bg-card text-left transition-shadow duration-[160ms] hover:layer-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        horizontal ? 'items-center gap-3 p-3.5' : 'flex-col gap-2.5 p-2.5',
        checked ? 'shadow-[inset_0_0_0_2px_var(--color-brand-fill)]' : 'shadow-none'
      )}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      {children}
      {horizontal ? (
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-body font-medium text-ink">{label}</span>
          {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
        </span>
      ) : (
        <span className="flex items-center justify-between gap-2 px-1 text-ui font-medium text-ink">
          <span className="truncate">{label}</span>
          {checked && <CheckMark />}
        </span>
      )}
    </button>
  );
}

function CheckMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-pill bg-brand-fill text-on-brand"
    >
      <Icon className="size-3.5 stroke-3" name="check" />
    </span>
  );
}

/*
 * Образцы рисуются нейтральными значениями палитры напрямую: data-preview
 * включает на элементе нужный блок palette.css, а семантические токены
 * вычислены на <html> и его не видят. Акцент — текущий.
 */

/** Мини-экран: список чатов слева, лента с двумя пузырями справа. */
function ThemePreview({ preview }: { preview: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-24 gap-1.5 rounded-[10px] bg-(--neutral-ground) p-2"
      data-preview={preview}
    >
      <span className="flex w-[34%] flex-col gap-1.25 rounded-[6px] bg-(--neutral-panel) p-1.5">
        <span className="h-1.75 rounded-[4px] bg-brand-fill" />
        <span className="h-1.75 rounded-[4px] bg-(--neutral-line)" />
        <span className="h-1.75 rounded-[4px] bg-(--neutral-line)" />
      </span>
      <span className="flex grow flex-col justify-end gap-1.25 rounded-[6px] bg-(--neutral-chat) p-1.5">
        <span className="h-3 w-[55%] self-start rounded-[6px] bg-(--neutral-bubble-in)" />
        <span className="h-3 w-[45%] self-end rounded-[6px] bg-brand-fill" />
      </span>
    </span>
  );
}

/** Четыре цвета палитры: фон, панель, приподнятое, второстепенный текст. */
function PaletteSwatches({ preview }: { preview: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-11 grid-cols-4 overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_var(--color-divider)]"
      data-preview={preview}
    >
      <span className="bg-(--neutral-ground)" />
      <span className="bg-(--neutral-panel)" />
      <span className="bg-(--neutral-raised)" />
      <span className="bg-(--neutral-ink-2)" />
    </span>
  );
}
