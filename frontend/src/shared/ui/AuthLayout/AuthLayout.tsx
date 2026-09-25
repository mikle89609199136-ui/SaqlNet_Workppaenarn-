import { cn } from '@/shared/lib';
import type { ReactNode } from 'react';
import { AnimatedHeight } from '../AnimatedHeight';

interface Props {
  /* Что написано под логотипом крупным шрифтом. */
  title: string;
  /* Строка пояснения под заголовком. */
  subtitle?: string;
  children: ReactNode;
  /* Ссылка на соседнюю страницу входной группы — она есть у обеих. */
  footer?: ReactNode;
  /* Регистрация ведёт человека по шагам и рисует свою шапку с кнопкой
     «назад», поэтому логотип и заголовок ей нужны только на первом шаге. */
  header?: ReactNode;
  className?: string;
}

/**
 * Общая рамка входа и регистрации.
 *
 * Вынесено ровно то, что у страниц действительно совпадает: подложка во
 * весь экран, карточка по центру, логотип с заголовком и подвал со
 * ссылкой на соседнюю страницу. Всё остальное у них разное — вход это
 * одна форма, регистрация мастер из трёх шагов, — и попытка обобщить
 * дальше кончилась бы пропсами вида `isRegister`.
 *
 * Отступы учитывают вырез экрана: на телефоне карточка иначе уезжает под
 * системную панель.
 *
 * Размер карточки меняется плавно: страница может её раздвинуть (вход по
 * QR) или сменить содержимое на другое по высоте, и скачок выглядел как
 * поломка.
 */
export function AuthLayout({ title, subtitle, children, footer, header, className }: Props) {
  return (
    <main
      className={cn(
        'relative flex min-h-screen items-center justify-center bg-ground px-5',
        'pt-[calc(20px+env(safe-area-inset-top,0px))] pb-[calc(20px+env(safe-area-inset-bottom,0px))]',
        'min-h-[100dvh]'
      )}
    >
      <section
        className={cn(
          'w-[min(100%,400px)] rounded-window border border-line bg-sheet px-5 py-6 text-center',
          'transition-[width] duration-panel ease-out motion-reduce:transition-none',
          'shadow-[var(--elev-3)] md:p-10',
          className
        )}
      >
        {header ?? (
          <>
            <div className="mx-auto mb-5 h-[90px] w-[90px] overflow-hidden rounded-window bg-brand-soft md:h-[120px] md:w-[120px]">
              <img alt="" className="h-full w-full object-cover" src="/logo.png" />
            </div>
            <h1 className="mb-2 text-display font-extrabold text-ink">{title}</h1>
            {subtitle && <p className="mb-6 text-caption text-ink-2">{subtitle}</p>}
          </>
        )}

        <AnimatedHeight>{children}</AnimatedHeight>

        {footer && <div className="mt-6 text-caption text-ink-2">{footer}</div>}
      </section>
    </main>
  );
}
