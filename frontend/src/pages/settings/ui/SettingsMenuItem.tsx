import { useEffect, useRef } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { Icon } from '@/shared/ui/Icon';
import { ROUTES, type TSettingsSection } from '@/shared/config/routes';
import type { TIconTypes } from '@/types';

interface Props {
  section: TSettingsSection;
  icon: TIconTypes;
  label: string;
}

/**
 * Пункт бокового меню настроек.
 *
 * Выделен из списка не ради красоты: активность определяется адресом, а
 * значит у пункта появляется своя работа — сверить маршрут и объявить
 * состояние. NavLink для этого не годится: он умеет отдать `isActive`
 * только в className и children, а состояние в проекте выражается
 * атрибутом `data-state`, у которого нет глобального имени и потому
 * нечему сталкиваться.
 *
 * `end: false` — чтобы «Аккаунт» оставался выбранным и на его
 * подстраницах вроде /settings/account/password.
 *
 * Выбранный раздел держится не подложкой, а полоской акцента и цветом
 * текста. Подложка `brand-soft` — это 11% акцента, по контрасту к фону
 * меню она даёт 1.17:1 в светлой теме и 1.10:1 в тёмной, тогда как фон
 * наведения `sheet-2` — 1.28:1 и 1.31:1. То есть одной заливкой пункт
 * под курсором выглядел бы заметнее текущего. Полоска даёт 5.4:1 и
 * 6.1:1, а наведение снято с выбранного пункта совсем: наводить на то,
 * где уже находишься, нечего.
 */
export function SettingsMenuItem({ icon, label, section }: Props) {
  const path = ROUTES.SETTINGS_SECTION(section);
  const isActive = Boolean(useMatch({ path, end: false }));
  const ref = useRef<HTMLAnchorElement>(null);

  /* На узком экране меню прокручивается вбок, и выбранный раздел легко
     оказывается за краем — открыв адрес напрямую, непонятно, где ты.
     `block: nearest` не даёт задеть вертикальную прокрутку страницы, а на
     широком экране прокручивать нечего, поэтому вызов там безвреден. */
  useEffect(() => {
    if (isActive) {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [isActive]);

  return (
    <Link
      ref={ref}
      className="text-caption flex min-h-[52px] shrink-0 items-center gap-3 border-b-2 border-transparent px-4 py-2.5 text-left font-semibold text-ink-2 transition-colors duration-fast not-data-[state=active]:hover:bg-sheet-2 not-data-[state=active]:hover:text-ink focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand data-[state=active]:border-brand data-[state=active]:bg-brand-soft data-[state=active]:text-brand md:w-full md:border-b-0 md:border-l-2 md:px-8"
      data-state={isActive ? 'active' : undefined}
      to={path}
    >
      <Icon className="shrink-0" name={icon} size="sm" />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}
