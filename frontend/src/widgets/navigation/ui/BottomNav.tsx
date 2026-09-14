import { NavTab } from './NavTab';
import { navItems } from '../model/navItems';

/**
 * Панель разделов внизу экрана телефона.
 *
 * Плавает над содержимым, а не прижата к краю: под ней остаётся полоса
 * фона, из-за которой панель читается как отдельный предмет, а не как
 * продолжение списка.
 *
 * Ширину задаёт не порог экрана, а сама панель: она тянется по месту и
 * упирается в предел, а подписи при нехватке ширины обрезаются. Раньше
 * для узких телефонов был отдельный `@media (max-width: 390px)`, где
 * подпись ужимали до 9px, — порог не из шкалы Tailwind, и держать его
 * ради одного размера экрана незачем.
 */
export function BottomNav() {
  return (
    <nav
      aria-label="Разделы"
      className="fixed bottom-8 left-1/2 z-[1000] flex h-[60px] w-[calc(100%-24px)] max-w-[360px] -translate-x-1/2 items-center rounded-pill border border-line bg-sheet px-0 shadow-[var(--elev-3)]"
    >
      {navItems.map((item) => (
        <NavTab item={item} key={item.key} variant="bottom" />
      ))}
    </nav>
  );
}
