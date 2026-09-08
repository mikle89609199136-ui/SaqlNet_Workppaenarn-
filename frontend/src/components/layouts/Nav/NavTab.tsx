import { Icon } from '@/components/ui';
import { cn } from '@/utils';
import { NavLink } from 'react-router-dom';
import type { INavItem } from './navItems';

interface Props {
  item: INavItem;
  /** Оформление: панель внизу телефона или боковой рельс. */
  variant: 'bottom' | 'side';
}

/**
 * Пункт навигации.
 *
 * Активность считает сам `NavLink`: его `isActive` сравнивает сегменты
 * пути, поэтому `/chats/<id>` подсвечивает «Чаты», а раздел, чей адрес
 * начинается так же, но продолжается иначе, — не подсвечивает. Раньше
 * здесь стояло `pathname.includes(path)`, то есть поиск подстроки: он
 * дал бы ложное совпадение первому же маршруту вроде `/chats-archive`.
 */
export function NavTab({ item, variant }: Props) {
  const bottom = variant === 'bottom';

  return (
    <NavLink
      className={({ isActive }) =>
        cn(
          'flex items-center justify-center transition-colors duration-fast cursor-pointer',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
          bottom
            ? 'flex-1 min-w-0 h-full flex-col gap-[3px] rounded-pill text-ink-2 active:scale-95'
            : 'size-[46px] rounded-field border border-transparent text-ink-2 hover:bg-sheet-2 hover:text-ink',
          isActive &&
            (bottom
              ? 'bg-line text-ink shadow-[var(--elev-1)]'
              : 'bg-brand-soft text-brand border-brand/32')
        )
      }
      to={item.path}
    >
      <Icon name={item.icon} size={bottom ? 'md' : 'lg'} />
      {bottom && (
        <span className="max-w-full truncate text-micro font-medium leading-none">
          {item.label}
        </span>
      )}
    </NavLink>
  );
}
