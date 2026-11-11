import { AVATAR_MAX_SIDE, renameForType } from '@/shared/lib/utils/encodeImage';

export interface CropPosition {
  x: number;
  y: number;
}

export const clampPosition = (value: number) => Math.max(-1, Math.min(1, value));

/** Position is a fraction of the available travel, so the crop always stays inside the photo. */
export function avatarCropRect(
  width: number,
  height: number,
  zoom: number,
  position: CropPosition
) {
  const side = Math.min(width, height) / zoom;
  return {
    x: ((width - side) * (1 - clampPosition(position.x))) / 2,
    y: ((height - side) * (1 - clampPosition(position.y))) / 2,
    side,
  };
}

export async function cropAvatar(
  image: HTMLImageElement,
  name: string,
  zoom: number,
  position: CropPosition
) {
  const { x, y, side } = avatarCropRect(image.naturalWidth, image.naturalHeight, zoom, position);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(AVATAR_MAX_SIDE, Math.max(1, Math.round(side)));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(image, x, y, side, side, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.85)
  );
  if (!blob) throw new Error('Avatar encoding failed');
  // Some browsers return PNG when WebP encoding is unavailable.
  const filename =
    blob.type === 'image/png'
      ? `${name.replace(/\.[^.]+$/, '')}.png`
      : renameForType(name, blob.type);
  return new File([blob], filename, { type: blob.type });
}
