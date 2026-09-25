import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

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
      className="mx-auto aspect-square w-[min(100%,260px)] rounded-field bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
    />
  );
}
