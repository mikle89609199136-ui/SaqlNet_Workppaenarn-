import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/utils';
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react';

const sizes = {
  xs: 'text-micro px-2 py-1 rounded-control gap-1',
  sm: 'text-caption px-3 py-1.5 rounded-control gap-1.5',
  md: 'text-body px-4.5 py-2.5 rounded-field gap-2',
  lg: 'text-title px-6 py-3.5 rounded-field gap-2',
} as const;

const iconOnlySizes = {
  xs: 'p-0.5 rounded-control',
  sm: 'p-1.5 rounded-control',
  md: 'p-2.5 rounded-field',
  lg: 'p-3.5 rounded-field',
} as const;

/* Рамка есть у каждого варианта: её ширина объявлена в общей части, а
   цвет — здесь, у всех четырёх. Без рамки кнопка на два пикселя ниже, и
   в подвале окна «Удалить» и «Отмена» встают разной высоты.

   Цвет обязан задаваться именно тут, а не общим border-transparent с
   перекрытием в варианте: обе утилиты пишут border-color, и побеждает
   та, что стоит позже в собранном CSS, а не в атрибуте. Прозрачная
   рамка у secondary — ровно этот случай, пойман измерением. */
const variants = {
  primary: 'bg-brand-fill text-on-brand border-transparent hover:bg-brand-fill-hover',
  secondary: 'bg-sheet-2 text-ink border-line hover:border-ink-3',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-sheet-2 hover:text-ink',
  danger: 'bg-transparent border-danger text-danger hover:bg-danger/10',
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
    'border',
    'disabled:opacity-42 disabled:cursor-not-allowed',
    'aria-disabled:opacity-42 aria-disabled:cursor-not-allowed',
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
