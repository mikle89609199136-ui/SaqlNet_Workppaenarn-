import { cn, useIsMobile } from '@/shared/lib';
import { Outlet } from 'react-router-dom';

/**
 * Каркас приложения (#818).
 *
 * Боковой и нижней навигации больше нет: разделы — вкладки в списке
 * чатов, настройки открываются кнопкой в его шапке. Каркас только даёт
 * фон окна и отступ, на котором лежат панели: 10px на планшете, 12 на ПК;
 * на телефоне панели занимают экран целиком.
 */
export function AppLayout() {
  const isMobile = useIsMobile();

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-ground text-ink transition-[background-color,color] duration-[250ms] md:p-2.5 xl:p-3">
      {/* mobile-content — зацепка для стилей ленты на телефоне: открытый
          чат там закреплён во весь экран (tailwind.css). */}
      <div className={cn('flex min-h-0 min-w-0 flex-1', isMobile && 'mobile-content flex-col')}>
        <Outlet />
      </div>
    </div>
  );
}
