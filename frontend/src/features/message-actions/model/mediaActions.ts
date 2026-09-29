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

/** Скачать уже расшифрованное вложение под именем fileName. */
export function saveMediaAs(url: string, fileName: string, doc: Document = document): void {
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  doc.body.append(link);
  link.click();
  link.remove();
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
 * ClipboardItem). PNG передаётся обещанием, а не готовым blob: Safari
 * разрешает запись в буфер только синхронно внутри нажатия, а
 * перекодирование асинхронное.
 */
export async function copyImageToClipboard(
  url: string,
  {
    clipboard = navigator.clipboard,
    ClipboardItemCtor = ClipboardItem,
    renderPng = renderPngFromImage,
  }: IClipboardDeps = {}
): Promise<void> {
  if (!clipboard) throw new Error('clipboard is unavailable');
  await clipboard.write([new ClipboardItemCtor({ 'image/png': renderPng(url) })]);
}
