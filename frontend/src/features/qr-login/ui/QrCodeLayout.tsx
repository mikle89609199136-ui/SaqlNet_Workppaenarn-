import type { ReactNode } from 'react';

interface Props {
  /** Шаги и предупреждения. */
  intro: ReactNode;
  /** Сам код или то, что стоит на его месте. */
  code: ReactNode;
  /** Подписи и ссылки под кодом. */
  actions?: ReactNode;
}

/**
 * Раскладка экрана с QR-кодом — по макету (#827).
 *
 * Где места хватает — шаги слева, код справа, под кодом отсчёт и
 * «Скопировать ссылку». В узкой колонке код первым, шаги под ним: на
 * телефоне человек пришёл за кодом, а шаги — пояснение. Порог — по ширине
 * самой панели, а не окна: панель живёт и в карточке входа, и в
 * настройках рядом с меню.
 */
export function QrCodeLayout({ intro, code, actions }: Props) {
  return (
    <div className="@container">
      <div className="flex flex-col items-stretch gap-7 text-left @xl:flex-row @xl:items-center">
        <div className="order-2 grid min-w-0 flex-1 gap-4 @xl:order-1">{intro}</div>
        {/* Ширина колонки задана: по содержимому браузер считал бы SVG кода
            без размера — 300 px, и колонка раздувалась. */}
        <div className="order-1 flex w-full shrink-0 flex-col items-center gap-2.5 @xl:order-2 @xl:w-56">
          {code}
          {actions}
        </div>
      </div>
    </div>
  );
}

/** Шаги под кодом — по макету: 14 px, свободный интерлиньяж. */
export function QrSteps({ children }: { children: ReactNode }) {
  return (
    <ol className="m-0 grid list-decimal gap-2.5 pl-5 text-ui leading-[1.5] text-ink-2">
      {children}
    </ol>
  );
}

/** Ссылка под кодом: «Скопировать ссылку», «Отсканировать код…». */
export function QrLinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="inline-flex cursor-pointer items-center gap-1.5 self-center rounded-field px-2.5 py-1.5 text-caption font-semibold text-brand hover:layer-hover focus-visible:outline-2 focus-visible:outline-brand [&_svg]:size-3.75 [&_svg]:stroke-[1.8px]"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
