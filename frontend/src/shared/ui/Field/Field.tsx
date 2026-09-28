import { cn } from '@/shared/lib';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/* Общая часть полей ввода: подпись сверху, подпись снизу и связка их с
   самим элементом управления. Вынесено потому, что это ровно тот
   договор, который обязаны соблюдать все шесть — поле, область,
   выпадающий список, флажок, переключатель. Держать его копиями значит
   получить шесть разных представлений о том, как выглядит ошибка. */

interface FieldOptions {
  id?: string;
  hint?: string;
  error?: string;
  /* Дополнительные описания — например счётчик знаков у области. */
  describedBy?: string[];
}

export function useField({ id, hint, error, describedBy = [] }: FieldOptions) {
  const ownId = useId();
  const fieldId = id ?? ownId;
  const captionId = `${fieldId}-caption`;
  const caption = error ?? hint;
  const descriptions = [caption ? captionId : null, ...describedBy].filter(Boolean);

  return {
    fieldId,
    captionId,
    caption,
    isError: Boolean(error),
    /* Готовые атрибуты для самого элемента: их легко забыть проставить
       руками, а без них подпись и ошибка для диктора не существуют. */
    controlProps: {
      id: fieldId,
      'aria-describedby': descriptions.length ? descriptions.join(' ') : undefined,
      'aria-invalid': error ? (true as const) : undefined,
    },
  };
}

/* Звёздочка — только для глаз: об обязательности диктору сообщает сам
   атрибут required, и повторять её словом «звёздочка» ни к чему.
   Отдельным выводом, потому что подпись бывает и не от FieldLabel: у
   флажка и переключателя она стоит справа, внутри общего label. */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-danger">
      {' *'}
    </span>
  );
}

export function FieldLabel({
  children,
  htmlFor,
  id,
  optional,
  required,
}: {
  children: ReactNode;
  htmlFor: string;
  /* Нужен там, где элемент управления — кнопка: её имя складывается из
     содержимого, поэтому подпись приходится привязывать через
     aria-labelledby, а не полагаться на htmlFor. */
  id?: string;
  /* «Необязательно» справа в подписи (дизайн-система, #817). В форме,
     где почти всё обязательно, отмечать проще исключения, чем правило. */
  optional?: boolean;
  required?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <label
      className="flex items-baseline justify-between gap-3 text-caption font-medium text-ink-2"
      htmlFor={htmlFor}
      id={id}
    >
      <span>
        {children}
        {required && <RequiredMark />}
      </span>
      {optional && !required && (
        <span className="font-normal text-ink-3">{t('optional', 'Необязательно')}</span>
      )}
    </label>
  );
}

/* Обвязка флажка и переключателя: подпись справа от квадрата или круга,
   подпись снизу — под обоими. У этих двух она общая целиком, поэтому
   лежит здесь, а не копией в каждом: иначе любая правка вида делается
   дважды и на второй раз забывается.

   children — сам элемент управления вместе со скрытым input. */
export function ChoiceField({
  caption,
  captionId,
  children,
  className,
  fieldId,
  isError,
  label,
  required,
}: {
  caption?: string;
  captionId: string;
  children: ReactNode;
  className?: string;
  fieldId: string;
  isError?: boolean;
  label?: string;
  required?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {/* Отключённость читается с самого input, а не с пропа: тогда она
          работает и когда элемент выключен снаружи — например, всей
          формой через fieldset disabled. */}
      <label
        className="flex w-fit cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-42"
        htmlFor={fieldId}
      >
        {children}
        {label && (
          <span className="text-body font-medium text-ink-2 select-none">
            {label}
            {required && <RequiredMark />}
          </span>
        )}
      </label>

      {caption && (
        <FieldCaption id={captionId} isError={isError}>
          {caption}
        </FieldCaption>
      )}
    </div>
  );
}

export function FieldCaption({
  children,
  id,
  isError,
}: {
  children: ReactNode;
  id: string;
  isError?: boolean;
}) {
  return (
    <p
      /* Подсказка мельче ошибки: её читают один раз, а ошибку надо
         заметить. */
      className={cn(isError ? 'text-caption text-danger' : 'text-meta text-ink-3')}
      id={id}
      /* Ошибка объявляется, когда появляется. Без этого диктор прочитает
         её, только если фокус вернётся на поле, — а при проверке по
         отправке формы человек уже ушёл дальше и об ошибке не узнает. */
      role={isError ? 'alert' : undefined}
    >
      {children}
    </p>
  );
}
