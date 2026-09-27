import { Spinner } from '@/shared/ui/Spinner';
import { cn } from '@/shared/lib';
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react';

/* Высоты — из дизайн-системы (#817): md — основная кнопка формы, 50px;
   sm — кнопки диалогов и форм внутри меню, 34px. xs и lg она не знает:
   xs остался у крестиков в плотных местах, lg — у крупных действий.

   Высота набирается отступом и интерлиньяжем (14 + 22 + 14 = 50), а не
   задаётся h-*: кнопки с содержимым в две строки растут, а не режут
   его, и место, где высоту надо переопределить, делает это как раньше —
   своим py-*. */
const sizes = {
  xs: 'text-micro px-2 py-1 rounded-control gap-1',
  sm: 'text-caption px-4 py-2 rounded-field gap-1.5',
  md: 'text-body px-5 py-3.5 rounded-button gap-2.5',
  lg: 'text-title px-6 py-4 rounded-button gap-2.5',
} as const;

/* Кнопка-иконка — квадрат. md — кнопка-иконка дизайн-системы: 40×40,
   в шапке чата, в поле ввода, в панелях. */
const iconOnlySizes = {
  xs: 'size-6 rounded-control',
  sm: 'size-8 rounded-field',
  md: 'size-10 rounded-icon',
  lg: 'size-12 rounded-button',
} as const;

/* Варианты — по весу действия, рамок нет ни у одного: кнопка узнаётся
   по заливке или по месту, как в дизайн-системе.

   ghost — «Отмена» и кнопки-иконки: без фона, цвет ink-2. accent —
   ссылка-действие («Забыли пароль?»), в дизайн-системе это ghost; здесь
   имя занято нейтральным вариантом, на котором держатся полсотни мест.
   danger — удаление и выход, на мягкой подложке ошибки.

   Наведение у всех, кроме основной, — слой поверх фона (layer-hover), а
   не замена фона: так у кнопки-иконки, включённой через aria-pressed,
   подсветка не стирает состояние. */
const variants = {
  primary: 'bg-brand-fill text-on-brand hover:bg-brand-fill-hover',
  secondary: 'bg-sheet-2 text-ink hover:layer-hover active:layer-press',
  ghost:
    'bg-transparent text-ink-2 hover:layer-hover hover:text-ink active:layer-press aria-pressed:text-brand',
  accent: 'bg-transparent text-brand hover:layer-hover active:layer-press',
  danger: 'bg-danger-soft text-danger hover:layer-hover active:layer-press',
} as const;

/* Круг — не украшение, а отдельная роль: кнопка при иконке, которая
   стоит в ряду других элементов и не должна выглядеть блоком. До этой
   опции каждое такое место дописывало rounded-full через className, и
   вместе с формой туда переезжали цвета — то есть вариант переставал
   значить что-либо. */
const shapes = {
  default: '',
  round: 'rounded-full',
} as const;

interface StyleProps {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  shape?: keyof typeof shapes;
  iconOnly?: boolean;
  className?: string;
}

/* Вынесено наружу ради того, что кнопкой не является: «Перейти в чат» —
   это ссылка, у неё свои правила навигации, и подменять её кнопкой с
   обработчиком нельзя. Пусть <Link> берёт оформление отсюда. */
export const buttonStyles = ({
  variant = 'primary',
  size = 'md',
  shape = 'default',
  iconOnly = false,
  className,
}: StyleProps = {}) =>
  cn(
    'inline-flex items-center justify-center font-semibold transition-colors duration-fast cursor-pointer',
    /* Выключенная кнопка остаётся на месте и видна: пусть будет понятно,
       какое действие есть и что для него нужно. */
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2',
    iconOnly ? iconOnlySizes[size] : sizes[size],
    variants[variant],
    /* После размера: радиус приходит оттуда, и round обязан его перебить. */
    shapes[shape],
    className
  );

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, StyleProps {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    shape = 'default',
    loading = false,
    iconOnly = false,
    disabled,
    className,
    children,
    onClick,
    ...rest
  },
  ref
) {
  if (import.meta.env.DEV && iconOnly && !rest['aria-label'] && !rest['aria-labelledby']) {
    console.warn('Button: кнопка-иконка без aria-label остаётся безымянной для скринридера.');
  }

  /* Во время загрузки кнопка гасится через aria-disabled, а не через
     disabled. Нативный disabled сбрасывает фокус на body и выкидывает
     кнопку из обхода табом — то есть человек, нажавший Enter, теряет
     место, а aria-busy некому объявить: фокуса на кнопке уже нет.
     Проверено в браузере. Нажатие вместо этого глушится обработчиком —
     он ловит и мышь, и Enter, и неявную отправку формы. */
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={buttonStyles({ variant, size, shape, iconOnly, className })}
      {...rest}
    >
      {loading && <Spinner size="text" tone="current" />}
      {/* Кнопка-иконка на время загрузки показывает только спиннер: иначе
          он встаёт рядом со значком, и она расползается прямо под курсором. */}
      {iconOnly && loading ? null : children}
    </button>
  );
});
