/**
 * Копирование картинки из меню сообщения (#655). Сохранение вложения —
 * в entities/media (saveMedia, mediaFileName).
 */

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
