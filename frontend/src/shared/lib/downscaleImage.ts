/**
 * Уменьшить картинку до квадрата заданной стороны.
 *
 * Аватарка группы уходит на сервер строкой в теле запроса, а тело чат-сервис
 * принимает не длиннее 256 КБ. Снимок с телефона в это не влезает и близко,
 * поэтому картинка уменьшается прямо в браузере: 256×256 в JPEG — около
 * двадцати килобайт.
 *
 * Обрезка по центру, а не растяжение: лицо на неквадратной фотографии
 * должно остаться лицом.
 */

const DEFAULT_SIZE = 256;
const DEFAULT_QUALITY = 0.8;

export async function downscaleImage(
  file: File,
  size = DEFAULT_SIZE,
  quality = DEFAULT_QUALITY
): Promise<string> {
  const bitmap = await loadImage(file);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить изображение');

  const side = Math.min(bitmap.width, bitmap.height);
  const left = (bitmap.width - side) / 2;
  const top = (bitmap.height - side) / 2;

  context.drawImage(bitmap, left, top, side, side, 0, 0, size, size);

  return canvas.toDataURL('image/jpeg', quality);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      // Адрес нужен только на время загрузки: без отзыва картинка осталась
      // бы в памяти вкладки до её закрытия.
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Не удалось прочитать изображение'));
    };

    image.src = objectUrl;
  });
}
