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
export function getImageExportConfig(source: { type?: string } | Blob): IImageExportConfig {
  const type = source.type?.toLowerCase() || '';

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
