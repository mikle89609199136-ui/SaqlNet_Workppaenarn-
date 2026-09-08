import { Icon, Tooltip } from '@/components/ui';
import { ROUTES } from '@/consts';
import { NavLink } from 'react-router-dom';
import { NavTab } from './NavTab';
import { sideNavItems } from './navItems';

const railButton =
  'flex size-11 items-center justify-center rounded-field text-ink-2 transition-colors duration-fast cursor-pointer hover:bg-sheet-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2';

/**
 * Боковой рельс разделов на широком экране.
 *
 * Подписи здесь не помещаются, поэтому названия живут в подсказках. До
 * этого подсказку рисовал `::after` с `attr(data-tip)` — тремя копиями
 * правила, без роли и без связи с кнопкой. `Tooltip` из набора делает то
 * же самое, но объявляет себя скринридеру и связывается через
 * `aria-describedby`.
 */
export function SideNav() {
  return (
    <nav
      aria-label="Разделы"
      className="z-[100] flex w-[72px] min-w-[72px] shrink-0 flex-col items-center gap-3 border-r border-line-soft bg-sheet py-6"
    >
      <Tooltip content="Меню" position="right">
        <NavLink aria-label="Меню" className={`${railButton} mb-4`} to={ROUTES.MENU}>
          <Icon name="burger" />
        </NavLink>
      </Tooltip>

      {sideNavItems.map((item) => (
        <Tooltip content={item.label} key={item.key} position="right">
          <NavTab item={item} variant="side" />
        </Tooltip>
      ))}

      <div className="flex-1" />

      <Tooltip content="Настройки" position="right">
        <NavLink aria-label="Настройки" className={railButton} to={ROUTES.SETTINGS}>
          <Icon name="settings" />
        </NavLink>
      </Tooltip>
    </nav>
  );
}
