export interface IImageExportConfig {
  mimeType: string;
  extension: string;
  quality?: number;
}

/**
 * Определяет параметры сохранения отредактированного изображения на основе типа исходного файла или Blob (#565).
 * - PNG: без параметра качества (lossless) для сохранения прозрачности, расширение png.
 * - WebP: качество 0.92, расширение webp.
 * - JPEG и прочие форматы: качество 0.94, расширение jpg.
 */
export function getImageExportConfig(source: { type?: string; name?: string }): IImageExportConfig {
  const extension = source.name?.split('.').pop()?.toLowerCase();
  const type =
    source.type?.toLowerCase() ||
    (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : '');

  if (type === 'image/png') {
    return {
      mimeType: 'image/png',
      extension: 'png',
    };
  }

  if (type === 'image/webp') {
    return {
      mimeType: 'image/webp',
      extension: 'webp',
      quality: 0.92,
    };
  }

  return {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    quality: 0.94,
  };
}
