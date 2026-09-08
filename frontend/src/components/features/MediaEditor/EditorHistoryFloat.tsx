import { Button, Icon } from '@/components/ui';

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function EditorHistoryFloat({ canUndo, canRedo, onUndo, onRedo }: Props) {
  return (
    <div className="absolute z-20 top-4 md:top-8 left-1/2 -translate-x-1/2 flex items-center gap-1.5 p-1.5 rounded-window bg-sheet-2/85 backdrop-blur-md shadow-[var(--elev-3)] border border-line-soft">
      <Button aria-label="Отменить" disabled={!canUndo} onClick={onUndo} size="sm" variant="ghost">
        <Icon name="undo" size="sm" />
      </Button>
      <Button aria-label="Повторить" disabled={!canRedo} onClick={onRedo} size="sm" variant="ghost">
        <Icon name="redo" size="sm" />
      </Button>
    </div>
  );
}
