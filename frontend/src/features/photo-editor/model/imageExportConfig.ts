export interface IImageExportConfig {
  mimeType: string;
  extension: string;
  quality?: number;
}

/**
 * Определяет параметры сохранения отредактированного изображения на основе типа исходного файла или Blob.
 * - PNG сохраняется как PNG без параметра качества (lossless) для сохранения прозрачности.
 * - WebP сохраняется с качеством 0.94.
 * - JPEG и прочие форматы экспортируются в JPEG с качеством 0.94.
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
      quality: 0.94,
    };
  }

  return {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    quality: 0.94,
  };
}
