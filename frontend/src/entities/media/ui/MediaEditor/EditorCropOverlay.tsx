import type { IEditorCrop } from '@/types';
import { cn } from '@/shared/lib';

interface Props {
  crop: IEditorCrop;
  onCropPointerDown: (event: React.PointerEvent, handle: string) => void;
}

const HANDLES: Array<{ id: string; className: string }> = [
  { id: 'nw', className: '-left-2 -top-2 cursor-nwse-resize' },
  { id: 'ne', className: '-right-2 -top-2 cursor-nesw-resize' },
  { id: 'sw', className: '-left-2 -bottom-2 cursor-nesw-resize' },
  { id: 'se', className: '-right-2 -bottom-2 cursor-nwse-resize' },
];

export function EditorCropOverlay({ crop, onCropPointerDown }: Props) {
  return (
    <div
      aria-label="Рамка обрезки"
      className="absolute border-2 border-brand-fill cursor-move touch-none shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)] z-10"
      onPointerDown={(event) => onCropPointerDown(event, 'move')}
      role="region"
      style={{
        left: `${crop.x * 100}%`,
        top: `${crop.y * 100}%`,
        width: `${crop.width * 100}%`,
        height: `${crop.height * 100}%`,
      }}
    >
      {HANDLES.map((handle) => (
        <span
          className={cn(
            'absolute w-4 h-4 border-2 border-white bg-brand-fill rounded-full z-20 shadow-sm',
            handle.className
          )}
          key={handle.id}
          onPointerDown={(event) => onCropPointerDown(event, handle.id)}
        />
      ))}
      <span className="absolute top-0 bottom-0 w-px bg-white/40 left-1/3 pointer-events-none" />
      <span className="absolute top-0 bottom-0 w-px bg-white/40 left-2/3 pointer-events-none" />
      <span className="absolute left-0 right-0 h-px bg-white/40 top-1/3 pointer-events-none" />
      <span className="absolute left-0 right-0 h-px bg-white/40 top-2/3 pointer-events-none" />
    </div>
  );
}
