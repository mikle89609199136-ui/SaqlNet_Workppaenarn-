import { EDITOR_FONTS } from '@/shared/config';
import type { IEditorPathObject, IEditorPoint, IEditorTextObject, TEditorObject } from '@/shared/types';

export function createEditorId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function cloneEditorState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function drawObject(
  context: CanvasRenderingContext2D,
  object: TEditorObject,
  width: number,
  height: number
): void {
  if (object.type === 'text') {
    const font = EDITOR_FONTS.find((item) => item.id === object.font) || EDITOR_FONTS[0];
    const size = object.size * (width / 1000);
    context.save();
    context.translate(object.x * width, object.y * height);
    context.rotate(((object.rotation || 0) * Math.PI) / 180);
    context.font = `700 ${size}px ${font.family}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = Math.max(2, size * 0.07);
    context.strokeStyle = 'rgba(0,0,0,.55)';
    context.fillStyle = object.color;
    context.strokeText(object.text, 0, 0);
    context.fillText(object.text, 0, 0);
    context.restore();
    return;
  }

  if (object.type !== 'path' || object.points.length < 2) return;
  const points = object.points.map((point) => ({ x: point.x * width, y: point.y * height }));
  const lineWidth = object.size * (width / 1000);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = object.color;
  context.lineWidth = Math.max(1, lineWidth);

  if (object.brush === 'marker') {
    context.globalAlpha = 0.35;
    context.lineWidth *= 2.3;
  } else if (object.brush === 'neon') {
    context.shadowColor = object.color;
    context.shadowBlur = context.lineWidth * 2.2;
  } else if (object.brush === 'eraser') {
    context.globalCompositeOperation = 'destination-out';
    context.lineWidth *= 2.4;
  } else if (object.brush === 'blur') {
    context.globalAlpha = 0.3;
    context.strokeStyle = '#ffffff';
    context.filter = `blur(${Math.max(3, context.lineWidth)}px)`;
    context.lineWidth *= 2;
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.stroke();

  if (object.brush === 'arrow') {
    const end = points[points.length - 1];
    const previous = points[Math.max(0, points.length - 3)];
    const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
    const head = Math.max(14, context.lineWidth * 3);
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - head * Math.cos(angle - Math.PI / 6),
      end.y - head * Math.sin(angle - Math.PI / 6)
    );
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - head * Math.cos(angle + Math.PI / 6),
      end.y - head * Math.sin(angle + Math.PI / 6)
    );
    context.stroke();
  }
  context.restore();
}

export function drawSelection(
  context: CanvasRenderingContext2D,
  object: TEditorObject,
  width: number,
  height: number
): void {
  if (object.type !== 'text') return;
  const font = EDITOR_FONTS.find((item) => item.id === object.font) || EDITOR_FONTS[0];
  const size = object.size * (width / 1000);
  context.save();
  context.font = `700 ${size}px ${font.family}`;
  const metrics = context.measureText(object.text);
  const boxWidth = metrics.width + 28;
  const boxHeight = size * 1.45;
  context.translate(object.x * width, object.y * height);
  context.rotate(((object.rotation || 0) * Math.PI) / 180);
  context.strokeStyle = 'rgba(255,255,255,.9)';
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.strokeRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
  context.restore();
}

export function findTextAtPoint(
  objects: TEditorObject[],
  point: IEditorPoint,
  _canvas: HTMLCanvasElement | null
): IEditorTextObject | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (object.type !== 'text') continue;
    const width = Math.max(0.08, (object.text.length * object.size) / 12000);
    const height = Math.max(0.05, object.size / 1200);
    if (Math.abs(point.x - object.x) <= width && Math.abs(point.y - object.y) <= height) {
      return object;
    }
  }
  return null;
}

export function splitPathByEraser(
  path: IEditorPathObject,
  point: IEditorPoint,
  radius: number
): IEditorPathObject[] {
  if (path.type !== 'path' || path.points.length < 2) return [path];

  const keptRuns: IEditorPoint[][] = [];
  let currentRun: IEditorPoint[] = [];
  let removedAny = false;

  path.points.forEach((pathPoint) => {
    const shouldErase = Math.hypot(pathPoint.x - point.x, pathPoint.y - point.y) <= radius;
    if (shouldErase) {
      removedAny = true;
      if (currentRun.length >= 2) keptRuns.push(currentRun);
      currentRun = [];
      return;
    }
    currentRun.push(pathPoint);
  });

  if (currentRun.length >= 2) keptRuns.push(currentRun);
  if (!removedAny) return [path];

  return keptRuns.map((points, index) => ({
    ...path,
    id: index === 0 ? path.id : createEditorId(),
    points,
    brush: path.brush === 'arrow' ? 'pen' : path.brush,
  }));
}
