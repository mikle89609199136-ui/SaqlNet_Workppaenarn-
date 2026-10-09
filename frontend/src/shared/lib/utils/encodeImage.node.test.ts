import { describe, expect, it } from 'vitest';
import { isReencodableImage, renameForType } from './encodeImage';
import { fitWithin } from './encodeImageSize';

describe('пересжатие картинок перед загрузкой', () => {
  it('уменьшает по длинной стороне и сохраняет пропорции', () => {
    expect(fitWithin(4032, 3024, 640)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(3024, 4032, 640)).toEqual({ width: 480, height: 640 });
  });

  it('маленькую картинку не увеличивает', () => {
    expect(fitWithin(300, 200, 640)).toEqual({ width: 300, height: 200 });
  });

  it('меняет расширение под новый формат', () => {
    expect(renameForType('IMG_0001.HEIC', 'image/webp')).toBe('IMG_0001.webp');
    expect(renameForType('photo.png', 'image/jpeg')).toBe('photo.jpg');
    expect(renameForType('.png', 'image/webp')).toBe('image.webp');
  });

  it('не трогает GIF и SVG: анимация и вектор при пересжатии теряются', () => {
    expect(isReencodableImage(new Blob([], { type: 'image/jpeg' }))).toBe(true);
    expect(isReencodableImage(new Blob([], { type: 'image/png' }))).toBe(true);
    expect(isReencodableImage(new Blob([], { type: 'image/gif' }))).toBe(false);
    expect(isReencodableImage(new Blob([], { type: 'image/svg+xml' }))).toBe(false);
    expect(isReencodableImage(new Blob([], { type: 'video/mp4' }))).toBe(false);
  });
});
