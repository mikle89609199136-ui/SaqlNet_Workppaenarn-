import { DEFAULT_CROP } from './config';
import type { IEditorCrop, TCropRatioValue } from './types';
import { clamp } from '@/shared/lib';
import { useCallback, useRef, type RefObject } from 'react';

interface Params {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  crop: IEditorCrop;
  setCrop: (crop: IEditorCrop) => void;
  cropRatio: TCropRatioValue;
  setCropRatio: (ratio: TCropRatioValue) => void;
  rotation: number;
  setRotation: (rotation: number | ((prev: number) => number)) => void;
  flipX: number;
  setFlipX: (flip: number | ((prev: number) => number)) => void;
  flipY: number;
  setFlipY: (flip: number | ((prev: number) => number)) => void;
  onCommit: (
    patch?: Partial<{
      crop: IEditorCrop;
      cropRatio: TCropRatioValue;
      rotation: number;
      flipX: number;
      flipY: number;
    }>
  ) => void;
}

interface CropPointerState {
  handle: string;
  startX: number;
  startY: number;
  initial: IEditorCrop;
}

export function usePhotoEditorCrop({
  canvasRef,
  stageRef,
  crop,
  setCrop,
  setCropRatio,
  rotation,
  setRotation,
  flipX,
  setFlipX,
  flipY,
  setFlipY,
  onCommit,
}: Params) {
  const cropPointerRef = useRef<CropPointerState | null>(null);

  const rotateImage = useCallback(() => {
    const nextRotation = rotation + 90;
    setRotation(nextRotation);
    setCrop(DEFAULT_CROP);
    onCommit({ rotation: nextRotation, crop: DEFAULT_CROP });
  }, [onCommit, rotation, setCrop, setRotation]);

  const flipImage = useCallback(
    (axis: 'x' | 'y') => {
      if (axis === 'x') {
        const next = flipX * -1;
        setFlipX(next);
        onCommit({ flipX: next });
      } else {
        const next = flipY * -1;
        setFlipY(next);
        onCommit({ flipY: next });
      }
    },
    [flipX, flipY, onCommit, setFlipX, setFlipY]
  );

  const selectRatio = useCallback(
    (value: TCropRatioValue) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let resolved: number | null = typeof value === 'number' ? value : null;
      if (value === 'original') resolved = canvas.width / canvas.height;
      let nextCrop = DEFAULT_CROP;
      if (typeof resolved === 'number') {
        const imageRatio = canvas.width / canvas.height;
        if (imageRatio > resolved) {
          const width = resolved / imageRatio;
          nextCrop = { x: (1 - width) / 2, y: 0, width, height: 1 };
        } else {
          const height = imageRatio / resolved;
          nextCrop = { x: 0, y: (1 - height) / 2, width: 1, height };
        }
      }
      setCropRatio(value);
      setCrop(nextCrop);
      onCommit({ cropRatio: value, crop: nextCrop });
    },
    [canvasRef, onCommit, setCrop, setCropRatio]
  );

  const handleCropPointerMove = useCallback(
    (event: PointerEvent) => {
      const active = cropPointerRef.current;
      const stage = stageRef.current;
      if (!active || !stage) return;
      const rect = stage.getBoundingClientRect();
      const dx = (event.clientX - active.startX) / rect.width;
      const dy = (event.clientY - active.startY) / rect.height;
      const next = { ...active.initial };
      const min = 0.08;

      if (active.handle === 'move') {
        next.x = clamp(active.initial.x + dx, 0, 1 - active.initial.width);
        next.y = clamp(active.initial.y + dy, 0, 1 - active.initial.height);
      } else {
        if (active.handle.includes('e')) {
          next.width = clamp(active.initial.width + dx, min, 1 - active.initial.x);
        }
        if (active.handle.includes('s')) {
          next.height = clamp(active.initial.height + dy, min, 1 - active.initial.y);
        }
        if (active.handle.includes('w')) {
          next.x = clamp(active.initial.x + dx, 0, active.initial.x + active.initial.width - min);
          next.width = active.initial.width + (active.initial.x - next.x);
        }
        if (active.handle.includes('n')) {
          next.y = clamp(active.initial.y + dy, 0, active.initial.y + active.initial.height - min);
          next.height = active.initial.height + (active.initial.y - next.y);
        }
      }
      setCrop(next);
      setCropRatio(null);
    },
    [setCrop, setCropRatio, stageRef]
  );

  const handleCropPointerUp = useCallback(() => {
    window.removeEventListener('pointermove', handleCropPointerMove);
    cropPointerRef.current = null;
    window.requestAnimationFrame(() => onCommit({ cropRatio: null }));
  }, [handleCropPointerMove, onCommit]);

  const handleCropPointerDown = useCallback(
    (event: React.PointerEvent, handle: string) => {
      event.preventDefault();
      event.stopPropagation();
      cropPointerRef.current = {
        handle,
        startX: event.clientX,
        startY: event.clientY,
        initial: { ...crop },
      };
      window.addEventListener('pointermove', handleCropPointerMove);
      window.addEventListener('pointerup', handleCropPointerUp, { once: true });
    },
    [crop, handleCropPointerMove, handleCropPointerUp]
  );

  return {
    rotateImage,
    flipImage,
    selectRatio,
    handleCropPointerDown,
  };
}
