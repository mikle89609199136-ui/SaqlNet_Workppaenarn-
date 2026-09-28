import { Link, useMatch } from 'react-router-dom';
import { cn, useIsMobile } from '@/shared/lib';
import { Icon } from '@/shared/ui/Icon';
import { ROUTES, type TSettingsSection } from '@/shared/config/routes';
import type { TIconTypes } from '@/types';

interface Props {
  section: TSettingsSection;
  icon: TIconTypes;
  label: string;
}

/**
 * Пункт меню настроек — по макету (#828): значок 18 px, подпись 15 px,
 * выбранный — на мягкой подложке акцента, значок цветом акцента. На
 * телефоне выбранного нет — раздел открывается отдельным экраном, — а
 * справа стрелка перехода.
 *
 * Активность определяется адресом: `end: false`, чтобы «Аккаунт» оставался
 * выбранным и на его подстраницах вроде /settings/account/password.
 */
export function SettingsMenuItem({ icon, label, section }: Props) {
  const path = ROUTES.SETTINGS_SECTION(section);
  const isPhone = useIsMobile();
  const isActive = Boolean(useMatch({ path, end: false })) && !isPhone;

  return (
    <Link
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex min-h-13 shrink-0 items-center gap-3.5 rounded-button px-3 py-2 text-left transition-colors duration-[160ms]',
        'focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand',
        isActive ? 'bg-brand-soft' : 'hover:layer-hover'
      )}
      to={path}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8.5 shrink-0 items-center justify-center transition-colors duration-[160ms]',
          isActive ? 'text-brand' : 'text-ink-2'
        )}
      >
        <Icon className="size-4.5 stroke-[1.8px]" name={icon} />
      </span>
      <span
        className={cn(
          'min-w-0 grow truncate text-body text-ink',
          isActive ? 'font-semibold' : 'font-normal'
        )}
      >
        {label}
      </span>
      {isPhone && (
        <Icon
          aria-hidden="true"
          className="size-4.5 shrink-0 stroke-2 text-ink-3"
          name="chevronRight"
        />
      )}
    </Link>
  );
}
