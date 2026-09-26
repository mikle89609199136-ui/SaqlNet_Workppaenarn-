import type { ReactNode } from 'react';

interface Props {
  /** Шаги и предупреждения. */
  intro: ReactNode;
  /** Сам код или то, что стоит на его месте. */
  code: ReactNode;
  /** Кнопки и подписи под кодом. */
  actions?: ReactNode;
}

/**
 * Раскладка экрана с QR-кодом.
 *
 * В узкой колонке — столбиком: шаги, код, действия. Где места хватает —
 * шаги с действиями слева, код справа, как у веб-версий мессенджеров:
 * столбиком шаги превращались в длинную ленту, а код уезжал за край
 * экрана. Порог — по ширине самой панели, а не окна: панель живёт и в
 * карточке входа, и в настройках рядом с меню.
 */
export function QrCodeLayout({ intro, code, actions }: Props) {
  return (
    <div className="@container">
      <div className="grid gap-4 text-left @xl:grid-cols-[minmax(0,1fr)_auto] @xl:grid-rows-[auto_1fr] @xl:items-start @xl:gap-x-10">
        <div className="grid gap-4 @xl:col-start-1 @xl:row-start-1">{intro}</div>
        <div className="@xl:col-start-2 @xl:row-span-2 @xl:row-start-1 @xl:w-[260px]">{code}</div>
        {actions && <div className="grid gap-3 @xl:col-start-1 @xl:row-start-2">{actions}</div>}
      </div>
    </div>
  );
}
