import { FieldCaption, RequiredMark, useField } from '@/components/ui/Field';
import { Radio } from '@/components/ui/Radio/Radio';
import { cn } from '@/utils';

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  /* Общее имя — это и есть взаимоисключение: браузер сам следит, чтобы
     отмеченным остался один, и сам водит стрелками по группе. */
  name: string;
  options: Option[];
  value?: string | null;
  onChange?: (value: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /**
   * Как расставить варианты. Вертикально по умолчанию: длинные подписи в
   * строку не помещаются, а взгляд по столбцу идёт быстрее. Горизонтально —
   * для двух-трёх коротких значений, когда весь выбор виден разом.
   */
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

/* Группа переключателей. Заведена отдельно, потому что поодиночке они
   бессмысленны: без общего name два переключателя отмечаются оба разом
   и ни один нельзя снять — снятие у радио браузером не предусмотрено. */
export function RadioGroup({
  className,
  disabled,
  error,
  hint,
  label,
  name,
  onChange,
  options,
  orientation = 'vertical',
  required,
  value,
}: Props) {
  const { captionId, caption, isError, controlProps } = useField({ hint, error });
  const isControlled = value !== undefined;

  return (
    <fieldset
      aria-describedby={controlProps['aria-describedby']}
      aria-invalid={controlProps['aria-invalid']}
      className={cn('flex flex-col gap-2.5', className)}
      disabled={disabled}
    >
      {label && (
        <legend className="text-caption mb-1.5 font-medium text-ink-2">
          {label}
          {required && <RequiredMark />}
        </legend>
      )}

      {/* Варианты лежат в своей обёртке, а не прямо в fieldset: legend
          участвует в раскладке родителя не так, как обычный элемент, и в
          строку вместе с вариантами его ставить нельзя. */}
      <div
        className={cn(
          'flex gap-2.5',
          orientation === 'horizontal' ? 'flex-row flex-wrap gap-x-6' : 'flex-col'
        )}
      >
        {options.map((option) => (
          <Radio
            checked={isControlled ? value === option.value : undefined}
            disabled={option.disabled}
            invalid={isError}
            key={option.value}
            label={option.label}
            name={name}
            onChange={() => onChange?.(option.value)}
            required={required}
            value={option.value}
          />
        ))}
      </div>

      {caption && (
        <FieldCaption id={captionId} isError={isError}>
          {caption}
        </FieldCaption>
      )}
    </fieldset>
  );
}
