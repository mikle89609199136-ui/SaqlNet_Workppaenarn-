import { fitWithin } from './encodeImageSize';

/**
 * Пересжатие картинки перед загрузкой: уменьшить и сохранить в WebP.
 *
 * Снимок с телефона весит мегабайты, а показывается в разы меньше — для
 * аватарки это кружок в 40–56 точек, в ленте — пара сотен точек по ширине.
 * Без пересжатия каждое открытие тянуло мегабайты ради этого.
 *
 * WebP — потому что при том же качестве он заметно легче JPEG и сохраняет
 * прозрачность. Кодировать в него умеют не все браузеры (Safari до 17 вместо
 * WebP молча отдаёт PNG) — тогда JPEG.
 *
 * Кодирование — в фоновом потоке (imageEncoder.worker.ts): WebP кодируется
 * в разы дольше JPEG, снимок 12 Мп на телефоне — секунды, и в основном
 * потоке интерфейс замирал бы. Где фонового холста нет — здесь же.
 */

export interface IEncodeImageOptions {
  /** Длинная сторона результата; меньшие картинки не увеличиваются. */
  maxSide: number;
  /** Качество 0…1 для WebP и JPEG. */
  quality?: number;
  /** Файлы легче этого не трогаются: выигрыш копеечный, время — нет. */
  minBytes?: number;
}

const DEFAULT_QUALITY = 0.82;

/** Имя файла с расширением под новый формат: photo.HEIC → photo.webp. */
export function renameForType(name: string, type: string): string {
  const extension = type === 'image/webp' ? 'webp' : 'jpg';
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.${extension}`;
}

/**
 * Картинку можно пересжать без потерь смысла. GIF — нет: в нём бывает
 * анимация, а холст сохраняет только первый кадр. SVG — вектор.
 */
export function isReencodableImage(file: Blob): boolean {
  return (
    file.type.startsWith('image/') && file.type !== 'image/gif' && file.type !== 'image/svg+xml'
  );
}

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  // createImageBitmap учитывает поворот из EXIF: снимок с телефона не ляжет
  // на бок. Где его нет — <img>, он поворачивает сам.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* не поддержал опцию или формат — пробуем через <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(Object.assign(image, { width: image.naturalWidth, height: image.naturalHeight }));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Пересжатие в основном потоке — там, где фонового холста нет. */
async function encodeOnMainThread(
  file: Blob,
  maxSide: number,
  quality: number
): Promise<Blob | null> {
  // Холст — до чтения картинки: нечем рисовать (тесты в jsdom) — и
  // разбирать файл незачем, а <img> там не загрузится никогда.
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  const source = await decode(file);
  const size = fitWithin(source.width, source.height, maxSide);
  canvas.width = size.width;
  canvas.height = size.height;
  context.drawImage(source, 0, 0, size.width, size.height);
  if ('close' in source && typeof source.close === 'function') source.close();

  let blob = await toBlob(canvas, 'image/webp', quality);
  // Safari до 17 вместо WebP возвращает PNG — тяжелее исходника. Тогда JPEG;
  // прозрачности в нём нет, и без подложки прозрачное стало бы чёрным.
  if (!blob || blob.type !== 'image/webp') {
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    blob = await toBlob(canvas, 'image/jpeg', quality);
  }
  return blob;
}

const canEncodeOffThread = () =>
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

/** Пересжатие в фоновом потоке; null — не вышло, пусть попробует основной. */
function encodeOffThread(file: Blob, maxSide: number, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./imageEncoder.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      resolve(null);
      return;
    }
    const finish = (blob: Blob | null) => {
      worker.terminate();
      resolve(blob);
    };
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) =>
      finish(event.data.blob ?? null);
    worker.onerror = () => finish(null);
    worker.postMessage({ file, maxSide, quality });
  });
}

/**
 * Уменьшить и сохранить в WebP (или JPEG, где WebP не кодируется).
 *
 * Не получилось — отдаётся исходный файл: загрузить тяжёлую картинку лучше,
 * чем не загрузить никакой. Если пересжатый файл вышел не легче исходного
 * (маленькая и уже сжатая картинка), тоже остаётся исходный.
 */
export async function encodeImage(
  file: File,
  { maxSide, quality = DEFAULT_QUALITY, minBytes = 0 }: IEncodeImageOptions
): Promise<File> {
  if (!isReencodableImage(file) || file.size < minBytes) return file;

  try {
    let blob = canEncodeOffThread() ? await encodeOffThread(file, maxSide, quality) : null;
    if (!blob) blob = await encodeOnMainThread(file, maxSide, quality);
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], renameForType(file.name, blob.type), {
      type: blob.type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/** Аватарка: показывается до 120 точек, с запасом на плотные экраны. */
export const AVATAR_MAX_SIDE = 640;

export const encodeAvatar = (file: File) => encodeImage(file, { maxSide: AVATAR_MAX_SIDE });

/**
 * Фото в чате: 2560 по длинной стороне — как «HD» в Telegram, чётко и на
 * весь экран, и при увеличении. Меньше 300 КБ — уже лёгкое, не трогаем.
 */
export const CHAT_PHOTO_MAX_SIDE = 2560;

export const encodeChatPhoto = (file: File) =>
  encodeImage(file, { maxSide: CHAT_PHOTO_MAX_SIDE, quality: 0.85, minBytes: 300 * 1024 });
