/**
 * Размер после уменьшения: длинная сторона не больше maxSide, пропорции те же.
 *
 * Отдельным файлом без обращений к document: им пользуется и фоновый поток
 * пересжатия (imageEncoder.worker.ts), где document нет.
 */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
