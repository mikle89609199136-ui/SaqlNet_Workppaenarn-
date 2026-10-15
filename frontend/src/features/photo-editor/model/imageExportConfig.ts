export interface IImageExportConfig {
  mimeType: string;
  extension: string;
  quality?: number;
}

/**
 * Определяет параметры сохранения отредактированного изображения на основе исходного типа файла.
 * - PNG сохраняется как PNG без параметра качества (lossless) для сохранения прозрачности.
 * - WebP сохраняется с качеством 0.94.
 * - JPEG и прочие форматы экспортируются в JPEG с качеством 0.94.
 */
export function getImageExportConfig(file: File): IImageExportConfig {
  if (file.type === 'image/png') {
    return {
      mimeType: 'image/png',
      extension: 'png',
    };
  }

  if (file.type === 'image/webp') {
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
