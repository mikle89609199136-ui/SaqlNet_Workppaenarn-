import type {
  IEditorPathObject,
  IEditorPoint,
  IEditorState,
  IEditorTextObject,
  TBrushType,
  TEditorObject,
  TEditorTool,
  TTextFontId,
} from './types';
import { clamp } from '@/shared/lib';
import {
  createEditorId,
  drawObject,
  findTextAtPoint,
  snapAngle,
  splitPathByEraser,
} from './editorCanvas';
import { useCallback, useRef, type RefObject } from 'react';

interface PointerDrawState {
  mode: 'draw';
  object: IEditorPathObject;
}

interface PointerEraseState {
  mode: 'erase';
  changed: boolean;
}

interface PointerMoveTextState {
  mode: 'move-text';
  id: string;
  start: IEditorPoint;
  initial: IEditorPoint;
}

type PointerState = PointerDrawState | PointerEraseState | PointerMoveTextState;

interface Params {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** null — инструмент не выбран: редактор только показывает фото. */
  tool: TEditorTool | null;
  brushType: TBrushType;
  brushColor: string;
  brushSize: number;
  textFont: TTextFontId;
  /** Размер, с которым появится новый текст. */
  textSize: number;
  objects: TEditorObject[];
  setObjects: (objects: TEditorObject[] | ((prev: TEditorObject[]) => TEditorObject[])) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setEditingTextId: (id: string | null) => void;
  onCommit: (patch?: Partial<IEditorState>) => void;
  renderCanvas: () => void;
}

export function usePhotoEditorDrawing({
  canvasRef,
  tool,
  brushType,
  brushColor,
  brushSize,
  textFont,
  textSize,
  objects,
  setObjects,
  selectedId,
  setSelectedId,
  setEditingTextId,
  onCommit,
  renderCanvas,
}: Params) {
  const pointerRef = useRef<PointerState | null>(null);

  const createTextObject = useCallback(
    (point = { x: 0.5, y: 0.5 }, value = ''): IEditorTextObject => ({
      id: createEditorId(),
      type: 'text',
      text: value,
      x: point.x,
      y: point.y,
      size: textSize,
      color: brushColor,
      font: textFont,
      rotation: 0,
    }),
    [brushColor, textFont, textSize]
  );

  const eraseAtPoint = useCallback(
    (point: IEditorPoint) => {
      const canvas = canvasRef.current;
      const normalizedRadius = Math.max(
        0.012,
        (brushSize * 2.8) / Math.max(320, canvas?.clientWidth || 1000)
      );
      setObjects((items) => {
        let changed = false;
        const next: TEditorObject[] = [];
        items.forEach((item) => {
          if (item.type !== 'path') {
            next.push(item);
            return;
          }
          const fragments = splitPathByEraser(item, point, normalizedRadius);
          if (fragments.length === 1 && fragments[0] === item) {
            next.push(item);
            return;
          }
          changed = true;
          next.push(...fragments);
        });
        if (changed && pointerRef.current?.mode === 'erase') {
          pointerRef.current.changed = true;
        }
        return next;
      });
    },
    [brushSize, canvasRef, setObjects]
  );

  const getNormalizedPoint = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): IEditorPoint => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      };
    },
    [canvasRef]
  );

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = getNormalizedPoint(event);
      event.currentTarget.setPointerCapture?.(event.pointerId);

      if (tool === 'draw') {
        if (brushType === 'eraser') {
          pointerRef.current = { mode: 'erase', changed: false };
          eraseAtPoint(point);
          return;
        }
        pointerRef.current = {
          mode: 'draw',
          object: {
            id: createEditorId(),
            type: 'path',
            brush: brushType,
            color: brushColor,
            size: brushSize,
            points: [point],
          },
        };
        return;
      }

      if (tool === 'text') {
        const hit = findTextAtPoint(objects, point, canvasRef.current);
        if (hit) {
          setSelectedId(hit.id);
          setEditingTextId(hit.id);
          pointerRef.current = {
            mode: 'move-text',
            id: hit.id,
            start: point,
            initial: { x: hit.x, y: hit.y },
          };
        } else {
          const object = createTextObject(point, '');
          const next = [...objects, object];
          setObjects(next);
          setSelectedId(object.id);
          setEditingTextId(object.id);
          onCommit({ objects: next });
        }
      }
    },
    [
      brushColor,
      brushSize,
      brushType,
      canvasRef,
      createTextObject,
      eraseAtPoint,
      getNormalizedPoint,
      objects,
      onCommit,
      setEditingTextId,
      setObjects,
      setSelectedId,
      tool,
    ]
  );

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const active = pointerRef.current;
      if (!active) return;
      const point = getNormalizedPoint(event);

      if (active.mode === 'draw') {
        active.object.points.push(point);
        const preview = active.object;
        renderCanvas();
        const context = canvasRef.current?.getContext('2d');
        if (context && canvasRef.current) {
          drawObject(context, preview, canvasRef.current.width, canvasRef.current.height);
        }
        return;
      }

      if (active.mode === 'erase') {
        eraseAtPoint(point);
        return;
      }

      if (active.mode === 'move-text') {
        const dx = point.x - active.start.x;
        const dy = point.y - active.start.y;
        setObjects((items) =>
          items.map((item) =>
            item.id === active.id
              ? {
                  ...item,
                  x: clamp(active.initial.x + dx, 0, 1),
                  y: clamp(active.initial.y + dy, 0, 1),
                }
              : item
          )
        );
      }
    },
    [canvasRef, eraseAtPoint, getNormalizedPoint, renderCanvas, setObjects]
  );

  const handleCanvasPointerUp = useCallback(() => {
    const active = pointerRef.current;
    if (!active) return;
    pointerRef.current = null;

    if (active.mode === 'draw' && active.object.points.length > 1) {
      const next = [...objects, active.object];
      setObjects(next);
      onCommit({ objects: next });
    } else if (active.mode === 'erase' && active.changed) {
      window.requestAnimationFrame(() => onCommit());
    } else if (active.mode === 'move-text') {
      window.requestAnimationFrame(() => onCommit());
    }
  }, [objects, onCommit, setObjects]);

  const addText = useCallback(() => {
    const object = createTextObject({ x: 0.5, y: 0.5 }, '');
    const next = [...objects, object];
    setObjects(next);
    setSelectedId(object.id);
    setEditingTextId(object.id);
    onCommit({ objects: next });
  }, [createTextObject, objects, onCommit, setEditingTextId, setObjects, setSelectedId]);

  const updateSelectedText = useCallback(
    (patch: Partial<IEditorTextObject>, shouldCommit = false) => {
      if (!selectedId) return;
      const next = objects.map((item) => (item.id === selectedId ? { ...item, ...patch } : item));
      setObjects(next);
      if (shouldCommit) onCommit({ objects: next });
    },
    [objects, onCommit, selectedId, setObjects]
  );

  // Поворот текста ручкой над рамкой: угол — направление от центра текста
  // к пальцу, отсчитанное от того, где палец начал.
  const handleTextRotateStart = useCallback(
    (event: React.PointerEvent) => {
      const canvas = canvasRef.current;
      const target = objects.find((item) => item.id === selectedId);
      if (!canvas || !target || target.type !== 'text') return;
      event.preventDefault();
      event.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      const centerX = rect.left + target.x * rect.width;
      const centerY = rect.top + target.y * rect.height;
      const angleAt = (x: number, y: number) =>
        (Math.atan2(y - centerY, x - centerX) * 180) / Math.PI;
      const startAngle = angleAt(event.clientX, event.clientY);
      const initialRotation = target.rotation || 0;

      const move = (moveEvent: PointerEvent) => {
        const rotation = snapAngle(
          initialRotation + angleAt(moveEvent.clientX, moveEvent.clientY) - startAngle
        );
        setObjects((items) =>
          items.map((item) => (item.id === target.id ? { ...item, rotation } : item))
        );
      };
      const finish = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        window.requestAnimationFrame(() => onCommit());
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [canvasRef, objects, onCommit, selectedId, setObjects]
  );

  const deleteSelectedText = useCallback(() => {
    if (!selectedId) return;
    const next = objects.filter((item) => item.id !== selectedId);
    setObjects(next);
    setSelectedId(null);
    setEditingTextId(null);
    onCommit({ objects: next });
  }, [objects, onCommit, selectedId, setEditingTextId, setObjects, setSelectedId]);

  return {
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    addText,
    updateSelectedText,
    deleteSelectedText,
    handleTextRotateStart,
  };
}
