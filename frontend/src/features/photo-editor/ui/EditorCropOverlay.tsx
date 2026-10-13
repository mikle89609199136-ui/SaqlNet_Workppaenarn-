import type { IEditorCrop } from '../model/types';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib';

interface Props {
  crop: IEditorCrop;
  onCropPointerDown: (event: React.PointerEvent, handle: string) => void;
}

/* Уголок — скобка по углу рамки и зона касания 44×44 внутрь рамки.
   Наружу ничего не выходит: сцена обрезает всё за краем фото, и прежние
   кружки 16px у края снимка были видны на четверть и не ловили палец. */
const HANDLES: Array<{ id: string; zone: string; bracket: string }> = [
  {
    id: 'nw',
    zone: 'left-0 top-0 cursor-nwse-resize',
    bracket: 'left-0 top-0 border-l-4 border-t-4 rounded-tl-[3px]',
  },
  {
    id: 'ne',
    zone: 'right-0 top-0 cursor-nesw-resize',
    bracket: 'right-0 top-0 border-r-4 border-t-4 rounded-tr-[3px]',
  },
  {
    id: 'sw',
    zone: 'left-0 bottom-0 cursor-nesw-resize',
    bracket: 'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-[3px]',
  },
  {
    id: 'se',
    zone: 'right-0 bottom-0 cursor-nwse-resize',
    bracket: 'right-0 bottom-0 border-r-4 border-b-4 rounded-br-[3px]',
  },
];

export function EditorCropOverlay({ crop, onCropPointerDown }: Props) {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t('photoEditor.cropFrame', 'Рамка обрезки')}
      className="absolute border border-white/90 cursor-move touch-none shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)] z-10"
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
          className={cn('absolute z-20 size-11', handle.zone)}
          key={handle.id}
          onPointerDown={(event) => onCropPointerDown(event, handle.id)}
        >
          <span
            className={cn('pointer-events-none absolute size-5.5 border-white', handle.bracket)}
          />
        </span>
      ))}
      <span className="absolute top-0 bottom-0 w-px bg-white/35 left-1/3 pointer-events-none" />
      <span className="absolute top-0 bottom-0 w-px bg-white/35 left-2/3 pointer-events-none" />
      <span className="absolute left-0 right-0 h-px bg-white/35 top-1/3 pointer-events-none" />
      <span className="absolute left-0 right-0 h-px bg-white/35 top-2/3 pointer-events-none" />
    </div>
  );
}
