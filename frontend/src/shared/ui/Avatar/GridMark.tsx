/* Сетка нарисована на 70% круга и по центру: если растянуть её на весь
   квадрат, скруглённые углы срежут крайние клетки и рисунок читается
   обрывком. */
export function GridMark({ bytes, box }: { bytes: Uint8Array; box: number }) {
  const field = box * 0.7;
  const offset = (box - field) / 2;
  const cell = field / 5;
  const rects = [];

  let byteIndex = 2;
  let bitShift = 0;

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const filled = (bytes[byteIndex] >> bitShift) & 1;
      bitShift++;

      if (bitShift === 8) {
        bitShift = 0;
        byteIndex++;
      }

      if (!filled) continue;

      const y = offset + row * cell;
      rects.push(
        <rect key={`${row}-${col}`} x={offset + col * cell} y={y} width={cell} height={cell} />
      );

      if (col !== 2) {
        rects.push(
          <rect
            key={`${row}-m${col}`}
            x={offset + (4 - col) * cell}
            y={y}
            width={cell}
            height={cell}
          />
        );
      }
    }
  }

  return (
    <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} fill="currentColor">
      {rects}
    </svg>
  );
}
