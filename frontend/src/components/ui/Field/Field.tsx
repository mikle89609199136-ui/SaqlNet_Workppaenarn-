import { cn } from '@/utils';
import { useId, type ReactNode } from 'react';

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
  const описания = [caption ? captionId : null, ...describedBy].filter(Boolean);

  return {
    fieldId,
    captionId,
    caption,
    isError: Boolean(error),
    /* Готовые атрибуты для самого элемента: их легко забыть проставить
       руками, а без них подпись и ошибка для диктора не существуют. */
    controlProps: {
      id: fieldId,
      'aria-describedby': описания.length ? описания.join(' ') : undefined,
      'aria-invalid': error ? (true as const) : undefined,
    },
  };
}

export function FieldLabel({
  children,
  htmlFor,
  id,
  required,
}: {
  children: ReactNode;
  htmlFor: string;
  /* Нужен там, где элемент управления — кнопка: её имя складывается из
     содержимого, поэтому подпись приходится привязывать через
     aria-labelledby, а не полагаться на htmlFor. */
  id?: string;
  required?: boolean;
}) {
  return (
    <label className="text-caption font-medium text-ink-2" htmlFor={htmlFor} id={id}>
      {children}
      {/* Звёздочка — только для глаз: об обязательности диктору сообщает
          сам атрибут required, и повторять её словом «звёздочка» ни к чему. */}
      {required && (
        <span aria-hidden="true" className="text-danger">
          {' *'}
        </span>
      )}
    </label>
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
      className={cn('text-caption', isError ? 'text-danger' : 'text-ink-3')}
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
