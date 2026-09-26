import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { cn } from '@/shared/lib';

interface Props {
  /**
   * Открыто ли окно. По умолчанию да: окна, которые родитель показывает
   * условным рендером, о состоянии не знают и знать не должны.
   */
  open?: boolean;
  /**
   * Заголовок окна. Он же имя окна для диктора. Не передаётся там, где
   * шапка рисуется своя, — тогда имя задаётся через `label`.
   */
  title?: string;
  /** Имя окна для диктора, когда своего заголовка нет. */
  label?: string;
  children: ReactNode;
  /** Кнопки действий. Рисуются в подвале, прижатыми вправо. */
  footer?: ReactNode;
  /** Крестик в шапке. Убирают там, где выбор обязателен. */
  closable?: boolean;
  onClose: () => void;
  className?: string;
}

/* Прокрутку держит счётчик открытых окон, а не каждое окно своим
   «запомнил — вернул». Окна бывают одно поверх другого, а снимая дерево,
   React очищает внешнее раньше внутреннего: внутреннее возвращало
   «hidden», запомненный при своём открытии, и страница переставала
   прокручиваться после ухода с экрана с двумя окнами (#90). */
let openModals = 0;
let overflowBeforeModals = '';

function lockPageScroll() {
  if (openModals === 0) {
    overflowBeforeModals = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openModals += 1;
}

function unlockPageScroll() {
  openModals -= 1;
  if (openModals === 0) document.body.style.overflow = overflowBeforeModals;
}

/**
 * Модальное окно.
 *
 * Собрано на `<dialog>`, а не на своей подложке с `position: fixed`:
 * браузер сам не выпускает фокус наружу, закрывает по Escape, рисует
 * затемнение и кладёт окно поверх всего, не заставляя выдумывать
 * `z-index`. Своя реализация всего этого заведомо хуже готовой — и
 * именно её в проекте четырежды написали руками.
 *
 * Чего браузер не делает и что доделано здесь: не блокирует прокрутку
 * страницы под окном и не возвращает фокус на элемент, которым окно
 * открыли.
 *
 * Заменил прежний Modal на `div` с собственной подложкой: там не было ни
 * ловушки фокуса, ни Escape, ни возврата фокуса, зато был цвет `#0a0a0d`
 * вне палитры и `z-index: 1000`, подобранный на глаз.
 */
export function Modal({
  open = true,
  title,
  label,
  children,
  footer,
  closable = true,
  onClose,
  className,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      openerRef.current = document.activeElement;

      /* showModal есть не везде, где выполняется этот код: в jsdom его
         нет вовсе. Без него окно останется обычным блоком в потоке —
         показать его всё равно лучше, чем не показать. */
      dialog.showModal?.();
      if (!dialog.open) dialog.setAttribute('open', '');

      return () => {
        /* Окно закрывается штатно, а не просто исчезает из разметки:
           `close()` возвращает фокус на элемент, которым его открыли, —
           это делает сам браузер. Родитель, снимающий окно условным
           рендером, об этом не знает, поэтому закрытие вызывается здесь.

           Возврат фокуса вручную не помогает: элемент к тому моменту уже
           перерисован, и фокус остаётся на body. */
        dialog.close?.();

        const opener = openerRef.current as HTMLElement | null;
        if (document.activeElement === document.body) opener?.focus?.();
      };
    }

    dialog.close?.();
    dialog.removeAttribute('open');
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    // Нативный <dialog> прокрутку под собой не блокирует: страница
    // продолжает ехать колесом, пока окно висит поверх.
    lockPageScroll();

    return unlockPageScroll;
  }, [open]);

  return (
    <dialog
      aria-label={title ? undefined : label}
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        /* m-auto возвращает центрирование: браузер центрирует <dialog>
           автоматическими полями, а сброс стилей Tailwind обнуляет margin
           у всех элементов — без этого окно прилипает к левому верхнему
           углу. */
        'm-auto w-[min(460px,calc(100vw-32px))] rounded-window border border-line bg-sheet p-0 text-ink shadow-[var(--elev-3)]',
        'backdrop:bg-black/50',
        className
      )}
      onCancel={(event) => {
        // Escape закрывает окно средствами браузера, но что это значит —
        // решает вызывающий код, а не разметка.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Клик мимо окна приходит на сам <dialog>: его прямоугольник —
        // это подложка, а содержимое лежит во вложенном блоке.
        if (event.target === dialogRef.current && closable) onClose();
      }}
      ref={dialogRef}
    >
      {/* Шапка и подвал рисуются, только когда о них попросили: окна со
          своей вёрсткой передают одно лишь содержимое. */}
      {title ? (
        <div className="flex flex-col gap-3 p-5">
          <header className="flex items-start justify-between gap-3">
            <h2 className="text-title font-semibold" id={titleId}>
              {title}
            </h2>
            {closable && (
              <button
                aria-label="Закрыть"
                className="-m-1 rounded-control p-1 text-ink-3 transition-colors duration-fast hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                onClick={onClose}
                type="button"
              >
                <Icon name="cross" size="sm" />
              </button>
            )}
          </header>

          <div className="text-body text-ink-2">{children}</div>

          {footer && <div className="mt-2 flex justify-end gap-2">{footer}</div>}
        </div>
      ) : (
        children
      )}
    </dialog>
  );
}
