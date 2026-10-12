/**
 * Пересжатие картинки в фоновом потоке (см. encodeImage.ts).
 *
 * WebP кодируется в разы дольше JPEG: снимок 12 Мп на телефоне — секунды.
 * В основном потоке интерфейс на это время замирал бы.
 */
import { fitWithin } from './encodeImageSize';

interface IRequest {
  file: Blob;
  maxSide: number;
  quality: number;
}

// Типы проекта — DOM, а не webworker (вместе они конфликтуют): у окна
// postMessage требует адресата, у воркера — нет.
const reply = (message: { blob: Blob } | { error: string }) =>
  (self as unknown as { postMessage: (data: unknown) => void }).postMessage(message);

self.onmessage = async (event: MessageEvent<IRequest>) => {
  const { file, maxSide, quality } = event.data;
  try {
    // Поворот из EXIF учитывается здесь же: снимок с телефона не ляжет на бок.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const size = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();

    let blob = await canvas.convertToBlob({ type: 'image/webp', quality });
    // Safari вместо WebP отдаёт PNG — тогда JPEG на белой подложке.
    if (blob.type !== 'image/webp') {
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size.width, size.height);
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    reply({ blob });
  } catch (error) {
    reply({ error: error instanceof Error ? error.message : 'encode failed' });
  }
};
