import { cn } from '@/shared/lib';
import type { TIconTypes } from '@/types';
import type { ReactNode } from 'react';
import { AnimatedHeight } from '../AnimatedHeight';
import { Icon } from '../Icon';

interface Props {
  /* Что написано под логотипом крупным шрифтом. */
  title: string;
  /* Строка пояснения под заголовком. */
  subtitle?: string;
  children: ReactNode;
  /* Ссылка на соседнюю страницу входной группы — под карточкой. */
  footer?: ReactNode;
  /* Регистрация ведёт человека по шагам и рисует свою шапку с кнопкой
     «назад», поэтому логотип и заголовок ей нужны только на первом шаге. */
  header?: ReactNode;
  /* Значок вместо логотипа: облачный пароль, passkey, «забыли пароль».
     Плитка на мягкой подложке акцента, как в макете. */
  icon?: TIconTypes;
  /* Широкая карточка — вход по QR: шаги слева, код справа. */
  wide?: boolean;
  /* Менять размер карточки плавно. Вход выключает: при смене «Пароль / QR»
     разом менялись ширина, высота и содержимое — карточка сразу встаёт в
     новый размер, а содержимое проявляется. */
  animateResize?: boolean;
  className?: string;
}

/**
 * Общая рамка входа и регистрации — по макету (#827).
 *
 * На ПК и планшете — карточка 440 px (по QR 740 px) по центру, на фоне
 * два размытых пятна акцента, которые медленно плывут; ссылка на соседнюю
 * страницу — под карточкой. На телефоне — во весь экран, ссылка внизу.
 *
 * Отступы учитывают вырез экрана: на телефоне карточка иначе уезжает под
 * системную панель. Размер карточки меняется плавно: страница может её
 * раздвинуть (вход по QR) или сменить содержимое на другое по высоте.
 *
 * Раздвигается карточка маской: содержимое сразу получает ширину, которая
 * будет в конце, и стоит по центру, а карточка открывает его, обрезая края.
 * Раньше текст вписывался в растущую карточку и на каждом кадре заново
 * переносился — строки скакали.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  header,
  icon,
  wide = false,
  animateResize = true,
  className,
}: Props) {
  return (
    <main
      className={cn(
        'relative flex min-h-[100dvh] justify-center overflow-hidden bg-sheet text-ink',
        'pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]',
        'md:items-center md:bg-ground md:p-6'
      )}
    >
      <span
        aria-hidden="true"
        className="auth-glow pointer-events-none absolute -top-55 -left-40 hidden size-155 rounded-pill bg-brand-soft blur-[90px] md:block"
      />
      <span
        aria-hidden="true"
        className="auth-glow pointer-events-none absolute -right-35 -bottom-50 hidden size-130 rounded-pill bg-brand-soft blur-[100px] [animation-delay:-5s] md:block"
      />

      <div
        className={cn(
          'relative flex w-full flex-col gap-4.5',
          animateResize &&
            'transition-[width] duration-panel ease-out motion-reduce:transition-none',
          'md:w-[min(100%,440px)]',
          wide && 'md:w-[min(100%,740px)]'
        )}
      >
        <section
          className={cn(
            'flex flex-1 flex-col bg-sheet px-5 pt-14 pb-6',
            'md:flex-none md:overflow-hidden md:rounded-card md:px-9 md:pt-9 md:pb-8 md:shadow-[var(--shadow-card)]',
            className
          )}
        >
          {/* Ширина содержимого — конечная ширина карточки без полей (72 px),
              но не шире окна: 440 → 368, 740 → 668. */}
          <div
            className={cn(
              'flex flex-1 flex-col md:mx-auto md:w-[min(calc(100vw-120px),368px)]',
              wide && 'md:w-[min(calc(100vw-120px),668px)]'
            )}
          >
            {header ?? <AuthHead icon={icon} subtitle={subtitle} title={title} />}

            {animateResize ? <AnimatedHeight>{children}</AnimatedHeight> : children}
          </div>
        </section>

        {footer && <div className="pb-6 text-center text-ui text-ink-2 md:pb-0">{footer}</div>}
      </div>
    </main>
  );
}

/**
 * Шапка карточки: плитка 60 px, заголовок и пояснение. На плитке — наш
 * журавль со свечением акцента, либо значок экрана на мягкой подложке.
 */
function AuthHead({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: TIconTypes;
}) {
  return (
    <div className="mb-6 flex animate-fade-in flex-col items-center gap-1.5 text-center">
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-3 flex size-15 items-center justify-center rounded-dialog bg-brand-soft text-brand"
        >
          <Icon className="size-7.5 stroke-[1.8px]" name={icon} />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="mb-3 block size-15 overflow-hidden rounded-dialog shadow-[0_12px_32px_var(--color-brand-soft)]"
        >
          <img alt="" className="size-full object-cover" src="/logo.png" />
        </span>
      )}
      <h1 className="m-0 text-display font-semibold tracking-[-0.01em]">{title}</h1>
      {subtitle && <p className="m-0 max-w-90 text-ui leading-[1.5] text-ink-2">{subtitle}</p>}
    </div>
  );
}
