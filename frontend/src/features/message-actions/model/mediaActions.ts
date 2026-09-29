import type { IMediaItem } from '@/types';
import { messageMediaType } from './messageActionRules';

/**
 * Действия с вложением из меню сообщения (#655): сохранить и скопировать
 * картинку. Вложение в ленте уже расшифровано в память (blob-адрес), так
 * что оба действия работают с ним, без запроса на сервер.
 */

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
};

const FALLBACK_EXTENSION: Record<string, string> = {
  image: 'jpg',
  video: 'mp4',
  audio: 'mp3',
  voice: 'ogg',
  file: 'bin',
};

const BASENAME: Record<string, string> = {
  image: 'photo',
  video: 'video',
  audio: 'audio',
  voice: 'voice',
  file: 'file',
};

function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Имя для «Сохранить как…»: исходное, если оно известно; иначе — по типу и
 * времени сообщения с расширением по MIME: `photo-2026-09-29-2105.jpg`.
 * У голосового имени нет никогда — его и не отправляют (#843).
 */
export function mediaFileName(message: IMediaItem): string {
  const type = messageMediaType(message) ?? 'file';
  const encryption = message.mediaEncryption ?? undefined;
  const metadata = message.metadata as
    { fileName?: string; mediaEncryption?: { fileName?: string; mimeType?: string } } | undefined;
  const original =
    encryption?.fileName ?? metadata?.mediaEncryption?.fileName ?? metadata?.fileName;
  if (original && type !== 'voice') return original;

  const mime = (encryption?.mimeType ?? metadata?.mediaEncryption?.mimeType ?? '')
    .split(';')[0]
    .trim();
  const extension = EXTENSIONS[mime] ?? FALLBACK_EXTENSION[type] ?? 'bin';
  const created = new Date(message.createdAt);
  const when = Number.isNaN(created.getTime()) ? new Date() : created;
  return `${BASENAME[type] ?? 'file'}-${stamp(when)}.${extension}`;
}

/** Скачать уже расшифрованное вложение под именем fileName — в папку загрузок. */
export function downloadMedia(url: string, fileName: string, doc: Document = document): void {
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  doc.body.append(link);
  link.click();
  link.remove();
}

interface ISaveFileHandle {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

type TSaveFilePicker = (options: {
  suggestedName: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<ISaveFileHandle>;

/** Системное окно «Сохранить как»: есть в Chrome и Edge на ПК, нет в Firefox, Safari и на телефонах. */
export function saveFilePicker(win: object = globalThis): TSaveFilePicker | null {
  const picker = (win as { showSaveFilePicker?: TSaveFilePicker }).showSaveFilePicker;
  return typeof picker === 'function' ? picker.bind(win) : null;
}

interface ISaveDeps {
  picker?: TSaveFilePicker | null;
  blobByUrl?: (url: string) => Blob | undefined;
  download?: (url: string, fileName: string) => void;
}

/**
 * «Сохранить как…»: окно выбора места с исходным именем, где браузер его
 * умеет; иначе — обычное скачивание. Отказ в окне — не ошибка, человек
 * просто передумал: возвращается 'cancelled'.
 */
export async function saveMedia(
  url: string,
  fileName: string,
  { picker = saveFilePicker(), blobByUrl, download = downloadMedia }: ISaveDeps = {}
): Promise<'saved' | 'downloaded' | 'cancelled'> {
  const blob = blobByUrl?.(url);
  if (!picker || !blob) {
    download(url, fileName);
    return 'downloaded';
  }

  const extension = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
  let handle: ISaveFileHandle;
  try {
    handle = await picker({
      suggestedName: fileName,
      ...(blob.type && extension ? { types: [{ accept: { [blob.type]: [extension] } }] } : {}),
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return 'cancelled';
    throw error;
  }
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return 'saved';
}

interface IClipboardDeps {
  clipboard?: Pick<Clipboard, 'write'>;
  ClipboardItemCtor?: typeof ClipboardItem;
  renderPng?: (url: string) => Promise<Blob>;
}

/** Умеет ли браузер класть картинку в буфер обмена. */
export function canCopyImageToClipboard(
  env: { clipboard?: Partial<Clipboard>; ClipboardItemCtor?: typeof ClipboardItem } = {
    clipboard: typeof navigator === 'undefined' ? undefined : navigator.clipboard,
    ClipboardItemCtor: typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem,
  }
): boolean {
  const Ctor = env.ClipboardItemCtor;
  if (!Ctor || typeof env.clipboard?.write !== 'function') return false;
  const supports = (Ctor as unknown as { supports?: (type: string) => boolean }).supports;
  return typeof supports === 'function' ? supports('image/png') : true;
}

/**
 * Картинка в PNG через canvas. Не через fetch: запрос к blob:-адресу
 * запрещён политикой безопасности (CSP connect-src), а картинку из blob:
 * показывать можно (img-src).
 */
export function renderPngFromImage(url: string, doc: Document = document): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = doc.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('canvas 2d is unavailable'));
        return;
      }
      context.drawImage(image, 0, 0);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('png encoding failed'))),
        'image/png'
      );
    };
    image.onerror = () => reject(new Error('image failed to load'));
    image.src = url;
  });
}

/**
 * Картинку — в буфер обмена как PNG (его понимают все браузеры с
 * ClipboardItem), а подпись, если есть, — рядом как текст: вставится то,
 * что принимает место вставки. PNG передаётся обещанием, а не готовым
 * blob: Safari разрешает запись в буфер только синхронно внутри нажатия,
 * а перекодирование асинхронное.
 */
export async function copyImageToClipboard(
  url: string,
  caption = '',
  {
    clipboard = navigator.clipboard,
    ClipboardItemCtor = ClipboardItem,
    renderPng = renderPngFromImage,
  }: IClipboardDeps = {}
): Promise<void> {
  if (!clipboard) throw new Error('clipboard is unavailable');
  const data: Record<string, Promise<Blob> | Blob> = { 'image/png': renderPng(url) };
  if (caption.trim()) data['text/plain'] = new Blob([caption], { type: 'text/plain' });
  await clipboard.write([new ClipboardItemCtor(data)]);
}
