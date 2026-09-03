import { Button, Icon } from '@/components/ui';
import type { TEditorTool } from '@/types';

interface Props {
  tool: TEditorTool;
  isReady: boolean;
  isSaving: boolean;
  onSetTool: (tool: TEditorTool) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function EditorToolbar({
  tool,
  isReady,
  isSaving,
  onSetTool,
  onCancel,
  onSave,
}: Props) {
  return (
    <nav className="grid grid-cols-6 gap-2 pt-3 md:pt-4 border-t border-line">
      <Button
        aria-label="Закрыть"
        className="h-11 rounded-control"
        onClick={onCancel}
        size="md"
        title="Закрыть"
        variant="danger"
      >
        <Icon name="cross" size="lg" />
      </Button>

      <Button
        aria-label="Кисть"
        className="h-11 rounded-control"
        onClick={() => onSetTool('draw')}
        size="md"
        title="Кисть"
        variant={tool === 'draw' ? 'primary' : 'secondary'}
      >
        <Icon name="pen" size="lg" />
      </Button>

      <Button
        aria-label="Текст"
        className="h-11 rounded-control"
        onClick={() => onSetTool('text')}
        size="md"
        title="Текст"
        variant={tool === 'text' ? 'primary' : 'secondary'}
      >
        <Icon name="type" size="lg" />
      </Button>

      <Button
        aria-label="Размер и обрезка"
        className="h-11 rounded-control"
        onClick={() => onSetTool('transform')}
        size="md"
        title="Размер и обрезка"
        variant={tool === 'transform' ? 'primary' : 'secondary'}
      >
        <Icon name="crop" size="lg" />
      </Button>

      <Button
        aria-label="Фильтры"
        className="h-11 rounded-control"
        onClick={() => onSetTool('adjust')}
        size="md"
        title="Фильтры"
        variant={tool === 'adjust' ? 'primary' : 'secondary'}
      >
        <Icon name="adjust" size="lg" />
      </Button>

      <Button
        aria-label="Сохранить"
        className="h-11 rounded-control"
        disabled={!isReady || isSaving}
        onClick={onSave}
        size="md"
        title="Сохранить"
        variant="primary"
      >
        <Icon name="check" size="lg" />
      </Button>
    </nav>
  );
}
