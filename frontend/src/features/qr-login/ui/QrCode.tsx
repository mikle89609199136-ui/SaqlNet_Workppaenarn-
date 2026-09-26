import qrcode from 'qrcode-generator';
import { useMemo, type ReactNode } from 'react';
import { cn } from '@/shared/lib';

/** Размер места под код — один для кода и для всего, что стоит вместо него. */
const FRAME = 'mx-auto aspect-square w-[min(100%,260px)] rounded-field';

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
    return code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [value]);

  return (
    <div
      aria-label={label}
      className={cn(FRAME, 'animate-fade-in bg-white p-2 [&>svg]:h-full [&>svg]:w-full')}
      dangerouslySetInnerHTML={{ __html: svg }}
      key={value}
      role="img"
    />
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
        'grid animate-fade-in place-content-center justify-items-center gap-3 border border-line bg-sheet-2 p-4 text-center'
      )}
    >
      {children}
    </div>
  );
}
