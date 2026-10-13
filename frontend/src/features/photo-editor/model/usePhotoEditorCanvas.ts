import type { IEditorCrop, IEditorFilter, TEditorObject, TEditorTool } from './types';
import { drawObject, drawSelection } from './editorCanvas';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Params {
  file: File | null;
  filters: IEditorFilter;
  rotation: number;
  flipX: number;
  flipY: number;
  crop: IEditorCrop;
  objects: TEditorObject[];
  selectedObject: TEditorObject | null;
  editingTextId: string | null;
  /** null — инструмент не выбран: редактор только показывает фото. */
  tool: TEditorTool | null;
  onCancel: () => void;
  onSave: (file: File) => void;
}

export function usePhotoEditorCanvas({
  file,
  filters,
  rotation,
  flipX,
  flipY,
  crop,
  objects,
  selectedObject,
  editingTextId,
  tool,
  onCancel,
  onSave,
}: Params) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const [readyFile, setReadyFile] = useState<File | null>(null);
  const isReady = readyFile !== null && readyFile === file;
  const [isSaving, setIsSaving] = useState(false);
  const [canvasDisplayWidth, setCanvasDisplayWidth] = useState(1000);

  const toneFilter = useMemo(
    () =>
      `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%) sepia(${filters.sepia}%)`,
    [filters.brightness, filters.contrast, filters.saturate, filters.sepia]
  );
  const blurRadius = filters.blur;

  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    const reader = new FileReader();

    reader.onload = () => {
      if (cancelled || typeof reader.result !== 'string') return;
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        imageRef.current = image;
        setReadyFile(file);
      };
      image.onerror = () => {
        if (!cancelled) onCancelRef.current?.();
      };
      image.src = reader.result;
    };
    reader.onerror = () => {
      if (!cancelled) onCancelRef.current?.();
    };
    reader.readAsDataURL(file);

    return () => {
      cancelled = true;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const updateSize = () => setCanvasDisplayWidth(canvas.getBoundingClientRect().width || 1000);
    updateSize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    observer?.observe(canvas);
    window.addEventListener('resize', updateSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [isReady]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !isReady) return;

    const rotated = Math.abs(rotation % 180) === 90;
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const targetWidth = rotated ? sourceHeight : sourceWidth;
    const targetHeight = rotated ? sourceWidth : sourceHeight;
    const scale = Math.min(1, 1800 / Math.max(targetWidth, targetHeight));
    canvas.width = Math.max(1, Math.round(targetWidth * scale));
    canvas.height = Math.max(1, Math.round(targetHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const drawPhoto = (filter: string) => {
      context.save();
      context.filter = filter;
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.scale(flipX, flipY);
      context.drawImage(
        image,
        (-sourceWidth * scale) / 2,
        (-sourceHeight * scale) / 2,
        sourceWidth * scale,
        sourceHeight * scale
      );
      context.restore();
    };
    // Размытие на холсте затягивает края в прозрачность, а при сохранении в
    // JPEG прозрачное становится чёрным — у снимка появлялась тёмная рамка.
    // Поэтому под размытым слоем — тот же снимок без размытия: полупрозрачные
    // края ложатся на фото, а не на пустоту.
    if (blurRadius > 0) drawPhoto(toneFilter);
    drawPhoto(blurRadius > 0 ? `${toneFilter} blur(${blurRadius}px)` : toneFilter);

    objects.forEach((object) => {
      const isEditingSelectedText =
        object.type === 'text' && object.id === editingTextId && tool === 'text';
      if (!isEditingSelectedText) drawObject(context, object, canvas.width, canvas.height);
    });

    if (selectedObject && tool === 'text' && editingTextId !== selectedObject.id) {
      drawSelection(context, selectedObject, canvas.width, canvas.height);
    }
  }, [
    blurRadius,
    editingTextId,
    flipX,
    flipY,
    isReady,
    objects,
    rotation,
    selectedObject,
    toneFilter,
    tool,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const saveImage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !file || isSaving) return;
    setIsSaving(true);
    try {
      const sx = Math.round(crop.x * canvas.width);
      const sy = Math.round(crop.y * canvas.height);
      const sw = Math.max(1, Math.round(crop.width * canvas.width));
      const sh = Math.max(1, Math.round(crop.height * canvas.height));
      const output = document.createElement('canvas');
      output.width = sw;
      output.height = sh;
      const ctx = output.getContext('2d');
      if (ctx) {
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      }
      const encode = (type: string, quality: number) =>
        new Promise<Blob | null>((resolve) => output.toBlob(resolve, type, quality));
      // WebP, как и прочие фото в чате (encodeImage): при отправке снимок из
      // редактора второй раз не пересжимается. Safari до 17 вместо WebP
      // отдаёт PNG — тогда JPEG.
      let blob = await encode('image/webp', 0.92);
      if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.94);
      if (!blob) throw new Error('Не удалось подготовить изображение');
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
      const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
      onSave(
        new File([blob], `${baseName}-edited.${extension}`, {
          type: blob.type,
          lastModified: Date.now(),
        })
      );
    } finally {
      setIsSaving(false);
    }
  }, [crop, file, isSaving, onSave]);

  return {
    canvasRef,
    stageRef,
    isReady,
    isSaving,
    canvasDisplayWidth,
    renderCanvas,
    saveImage,
  };
}
