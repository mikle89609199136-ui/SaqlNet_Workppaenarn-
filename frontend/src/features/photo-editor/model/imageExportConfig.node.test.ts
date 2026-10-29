import { describe, expect, it } from 'vitest';
import { getImageExportConfig } from './imageExportConfig';

describe('getImageExportConfig', () => {
  it('возвращает mimeType image/png и расширение png без quality для PNG', () => {
    const file = new File(['png-data'], 'avatar.png', { type: 'image/png' });
    const config = getImageExportConfig(file);

    expect(config).toEqual({
      mimeType: 'image/png',
      extension: 'png',
    });
    expect(config.quality).toBeUndefined();
  });

  it('возвращает mimeType image/webp, расширение webp и quality 0.92 для WebP', () => {
    const file = new File(['webp-data'], 'photo.webp', { type: 'image/webp' });
    const config = getImageExportConfig(file);

    expect(config).toEqual({
      mimeType: 'image/webp',
      extension: 'webp',
      quality: 0.92,
    });
  });

  it('возвращает mimeType image/jpeg, расширение jpg и quality 0.94 для JPEG', () => {
    const file = new File(['jpeg-data'], 'photo.jpeg', { type: 'image/jpeg' });
    const config = getImageExportConfig(file);

    expect(config).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg',
      quality: 0.94,
    });
  });

  it('нормализует регистр MIME-типа', () => {
    expect(getImageExportConfig({ type: 'image/PNG' })).toEqual({
      mimeType: 'image/png',
      extension: 'png',
    });
    expect(getImageExportConfig({ type: 'IMAGE/WEBP' })).toEqual({
      mimeType: 'image/webp',
      extension: 'webp',
      quality: 0.92,
    });
    expect(getImageExportConfig({ type: 'Image/JPEG' })).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg',
      quality: 0.94,
    });
  });

  it('принимает объект Blob и объект с опциональным type', () => {
    const blob = new Blob(['data'], { type: 'image/png' });
    expect(getImageExportConfig(blob)).toEqual({
      mimeType: 'image/png',
      extension: 'png',
    });

    expect(getImageExportConfig({})).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg',
      quality: 0.94,
    });
  });

  it('возвращает JPEG fallback для неподдерживаемых или неопределённых типов', () => {
    const file = new File(['other-data'], 'image.bmp', { type: 'image/bmp' });
    const config = getImageExportConfig(file);

    expect(config).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg',
      quality: 0.94,
    });
  });
});

describe('пустой MIME из буфера обмена', () => {
  it.each(['png', 'webp', 'PNG', 'WEBP'])('определяет формат по имени .%s', (extension) => {
    expect(getImageExportConfig(new File(['data'], `photo.${extension}`)).extension).toBe(
      extension.toLowerCase()
    );
  });

  it('фактический MIME имеет приоритет над именем', () => {
    expect(getImageExportConfig({ type: 'image/png', name: 'photo.webp' }).extension).toBe('png');
  });
});
