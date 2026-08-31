import type { ReactNode } from 'react';

/**
 * Общие части разделов настроек.
 *
 * Здесь только раскладка: что за раздел и как расставлены его ряды. Сами
 * элементы управления берутся из библиотеки компонентов — раздел решает,
 * что сохраняется, а не как выглядит переключатель.
 */

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsSection({ title, description, children }: SectionProps) {
  return (
    <section className="mb-7">
      <header className="mb-3">
        <h1 className="mb-1 text-[21px] leading-tight font-semibold text-ink">{title}</h1>
        {description && <p className="text-caption text-ink-2">{description}</p>}
      </header>
      <div className="grid gap-4 rounded-bubble border border-line bg-sheet p-5 shadow-[var(--elev-2)]">
        {children}
      </div>
    </section>
  );
}

interface RowProps {
  /**
   * Подпись ряда. Не передаётся, когда её рисует сам элемент управления:
   * у группы переключателей это `legend`, и вторая подпись сделала бы
   * диктору две надписи на один вопрос.
   */
  label?: string;
  /** Пояснение под подписью — когда из названия не понятно, что изменится. */
  description?: string;
  /**
   * Идентификатор элемента управления. Связывает с ним подпись: она стоит
   * слева, вне компонента, поэтому связь приходится задавать здесь.
   *
   * Годится только для полей формы. Группе (`role="group"`, `fieldset`)
   * `htmlFor` указывать нельзя — там подпись связывают через
   * `aria-labelledby`, и тогда группа рисует её сама.
   */
  controlId?: string;
  children: ReactNode;
}

/**
 * Ряд настройки: подпись слева, элемент управления справа.
 *
 * Компоненты библиотеки рисуют подпись рядом с собой — так устроена форма,
 * которую заполняют. Настройки читают иначе: взглядом сверху вниз по
 * названиям, и уже потом смотрят, что справа. Поэтому подпись вынесена в
 * ряд, а компонент вставляется без своей.
 */
export function SettingsRow({ label, description, controlId, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      {label && (
        <div className="min-w-0">
          <label className="text-body block cursor-pointer text-ink" htmlFor={controlId}>
            {label}
          </label>
          {description && <p className="text-caption mt-0.5 text-ink-2">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Field({ label, multiline = false, onChange, type = 'text', value, ...props }) {
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <label className="settings-field">
      <span>{label}</span>
      <Tag
        type={multiline ? undefined : type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={multiline ? 3 : undefined}
        {...props}
      />
    </label>
  );
}
