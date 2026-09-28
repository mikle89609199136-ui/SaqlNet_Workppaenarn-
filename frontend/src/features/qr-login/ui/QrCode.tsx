import qrcode from 'qrcode-generator';
import { useMemo, type ReactNode } from 'react';
import { cn } from '@/shared/lib';

/** Размер места под код — один для кода и для всего, что стоит вместо
    него. По макету (#827): 224 px, скругление 22, тонкое кольцо линии. */
const FRAME = 'mx-auto aspect-square w-[min(100%,224px)] rounded-[22px] ring-1 ring-divider';

interface Props {
  value: string;
  label: string;
}

/**
 * QR-код, нарисованный на клиенте.
 *
 * Фон белый, а не из темы: камеры телефонов уверенно читают только тёмные
 * модули на светлом поле, и в тёмной теме инвертированный код многие не
 * распознают. Это единственное место, где цвет берётся не из токенов.
 *
 * Новый код проявляется, а не подменяется молча: код меняется каждые 30
 * секунд (#753), и мгновенная подмена выглядела как мигание.
 */
export function QrCode({ value, label }: Props) {
  const svg = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    return code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, [value]);

  /* Наш журавль в центре кода — по макету. Закрывает около 4% модулей;
     уровень коррекции M восстанавливает до 15%, камеры читают уверенно. */
  return (
    <div
      aria-label={label}
      className={cn(FRAME, 'relative animate-fade-in bg-white p-3.5')}
      key={value}
      role="img"
    >
      <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 size-11 -translate-1/2 overflow-hidden rounded-icon border-4 border-white bg-white"
      >
        <img alt="" className="size-full object-cover" src="/logo.png" />
      </span>
    </div>
  );
}

/**
 * Что стоит на месте кода, пока его нет: загрузка, «код отсканирован».
 * Того же размера, что и код, — иначе экран прыгает при каждой смене.
 */
export function QrFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        FRAME,
        'grid animate-fade-in place-content-center justify-items-center gap-3 border border-divider bg-sheet-2 p-4 text-center'
      )}
    >
      {children}
    </div>
  );
}
