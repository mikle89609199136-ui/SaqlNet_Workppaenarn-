import { cn } from '@/shared/lib';
import { Icon } from '../Icon';
import type { TIconTypes } from '@/types';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/*
 * Сгруппированный список — по макету (#828): карточка с рядами и
 * заголовком капсом над ней. Так устроены настройки и их подстраницы.
 *
 * Группа — заголовок над карточкой и пояснение под ней. Ряды внутри
 * карточки разделены линией. Ряд бывает четырёх видов: переход (стрелка
 * справа), переключатель, выбор одного из многих и ряд без своего действия
 * (сведения или кнопка справа). У всех — плитка со значком слева, подпись и
 * пояснение.
 */

interface GroupProps {
  title?: string;
  /** Пояснение под карточкой. */
  note?: ReactNode;
  /** Ряды — выбор одного из многих; заголовок становится подписью выбора. */
  radiogroup?: boolean;
  children: ReactNode;
  className?: string;
}

export function ListGroup({ title, note, radiogroup = false, children, className }: GroupProps) {
  const titleId = useId();
  const noteId = useId();
  return (
    <section aria-label={title} className={cn('flex flex-col gap-2.5', className)}>
      {title && (
        <h3
          className="mx-1 my-0 text-caption font-semibold tracking-[0.04em] text-ink-3 uppercase"
          id={titleId}
        >
          {title}
        </h3>
      )}
      <div
        aria-describedby={radiogroup && note ? noteId : undefined}
        aria-labelledby={radiogroup && title ? titleId : undefined}
        className="flex flex-col divide-y divide-divider overflow-hidden rounded-dialog bg-card"
        role={radiogroup ? 'radiogroup' : undefined}
      >
        {children}
      </div>
      {note && (
        <p className="mx-1 my-0 text-caption leading-[1.45] text-ink-3" id={noteId}>
          {note}
        </p>
      )}
    </section>
  );
}

/** Вводный абзац над группами. */
export function ListIntro({ children }: { children: ReactNode }) {
  return <p className="m-0 text-ui leading-[1.5] text-ink-2">{children}</p>;
}

type TTone = 'default' | 'danger';

interface ItemBodyProps {
  icon?: TIconTypes;
  /** Своя картинка вместо плитки — аватар человека. */
  leading?: ReactNode;
  tone?: TTone;
  label: ReactNode;
  hint?: ReactNode;
}

/*
 * Имя ряда — подпись, пояснение — описание: aria-labelledby и
 * aria-describedby. Иначе всё содержимое кнопки склеилось бы в одно имя —
 * «EnglishАнглийский», — и в нём потерялась бы сама подпись.
 */
function useItemIds() {
  const id = useId();
  return { label: `${id}-label`, hint: `${id}-hint`, value: `${id}-value` };
}

type TItemIds = ReturnType<typeof useItemIds>;

function a11y(ids: TItemIds, body: ItemBodyProps, withValue = false) {
  return {
    'aria-labelledby': withValue ? `${ids.label} ${ids.value}` : ids.label,
    'aria-describedby': body.hint ? ids.hint : undefined,
  };
}

function ItemBody({
  icon,
  leading,
  tone = 'default',
  label,
  hint,
  ids,
}: ItemBodyProps & { ids?: TItemIds }) {
  return (
    <>
      {leading ??
        (icon && (
          <span
            aria-hidden="true"
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-[9px]',
              tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand'
            )}
          >
            <Icon className="size-4.5 stroke-[1.8px]" name={icon} />
          </span>
        ))}
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span
          className={cn('text-body', tone === 'danger' ? 'text-danger' : 'text-ink')}
          id={ids?.label}
        >
          {label}
        </span>
        {hint && (
          <span className="text-caption leading-[1.35] text-ink-3" id={ids?.hint}>
            {hint}
          </span>
        )}
      </span>
    </>
  );
}

const ROW =
  'flex min-h-14 w-full items-center gap-3.5 px-4 py-2 text-left transition-colors duration-fast';
const INTERACTIVE =
  'cursor-pointer hover:layer-hover active:layer-press focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand';

interface NavItemProps extends ItemBodyProps {
  /** Значение справа: «не привязана», «Все», число. */
  value?: ReactNode;
  to?: string;
  onClick?: () => void;
}

/** Ряд-переход: ведёт на подстраницу или выполняет действие. */
export function ListNavItem({ value, to, onClick, ...body }: NavItemProps) {
  const ids = useItemIds();
  const hasValue = value !== undefined && value !== null && value !== '';
  const labels = a11y(ids, body, hasValue);
  const content = (
    <>
      <ItemBody {...body} ids={ids} />
      {hasValue && (
        <span className="shrink-0 text-ui text-ink-3" id={ids.value}>
          {value}
        </span>
      )}
      {/* Опасное действие — не переход: стрелки у него в макете нет. */}
      {body.tone !== 'danger' && (
        <Icon
          aria-hidden="true"
          className="size-4.5 shrink-0 stroke-2 text-ink-3"
          name="chevronRight"
        />
      )}
    </>
  );

  return to ? (
    <Link {...labels} className={cn(ROW, INTERACTIVE)} to={to}>
      {content}
    </Link>
  ) : (
    <button {...labels} className={cn(ROW, INTERACTIVE)} onClick={onClick} type="button">
      {content}
    </button>
  );
}

interface SwitchItemProps extends ItemBodyProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Ряд-переключатель: весь ряд — одна кнопка `role="switch"`. */
export function ListSwitchItem({ checked, onChange, disabled, ...body }: SwitchItemProps) {
  const ids = useItemIds();
  return (
    <button
      {...a11y(ids, body)}
      aria-checked={checked}
      className={cn(ROW, INTERACTIVE, 'disabled:cursor-default disabled:opacity-50')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <ItemBody {...body} ids={ids} />
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6.5 w-11 shrink-0 rounded-pill transition-colors duration-[200ms]',
          checked ? 'bg-brand-fill' : 'bg-divider'
        )}
      >
        <span
          className={cn(
            'absolute top-0.75 left-0.75 size-5 rounded-pill bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]',
            checked && 'translate-x-4.5'
          )}
        />
      </span>
    </button>
  );
}

interface RadioItemProps extends ItemBodyProps {
  checked: boolean;
  onSelect: () => void;
}

/** Ряд выбора одного из многих — внутри группы с `role="radiogroup"`. */
export function ListRadioItem({ checked, onSelect, ...body }: RadioItemProps) {
  const ids = useItemIds();
  return (
    <button
      {...a11y(ids, body)}
      aria-checked={checked}
      className={cn(ROW, INTERACTIVE)}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <ItemBody {...body} ids={ids} />
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5.5 shrink-0 items-center justify-center rounded-pill border-2 text-on-brand transition-colors duration-[160ms]',
          checked ? 'border-brand-fill bg-brand-fill' : 'border-divider bg-transparent'
        )}
      >
        {checked && <Icon className="size-3.5 stroke-3" name="check" />}
      </span>
    </button>
  );
}

interface StaticItemProps extends ItemBodyProps {
  /** Что справа: кнопка действия, значение, свой элемент. */
  trailing?: ReactNode;
}

/** Ряд без собственного действия: сведения или кнопка справа. */
export function ListStaticItem({ trailing, ...body }: StaticItemProps) {
  return (
    <div className={ROW}>
      <ItemBody {...body} />
      {trailing}
    </div>
  );
}

/** Кнопка в ряду — небольшая, на мягкой подложке. */
export function ListItemButton({
  children,
  onClick,
  danger = false,
  disabled = false,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        'h-8.5 shrink-0 cursor-pointer rounded-field px-3.5 text-caption font-semibold transition-colors duration-fast hover:layer-hover disabled:cursor-default disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        danger ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand'
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
