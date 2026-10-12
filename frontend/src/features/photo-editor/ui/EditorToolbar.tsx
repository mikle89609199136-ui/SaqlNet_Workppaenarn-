import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/shared/ui';
import type { TIconTypes } from '@/types/icons';
import type { TEditorTool } from '../model/types';

const TOOLS: Array<{ id: TEditorTool; label: string; icon: TIconTypes }> = [
  { id: 'draw', label: 'Кисть', icon: 'pen' },
  { id: 'text', label: 'Текст', icon: 'type' },
  { id: 'transform', label: 'Обрезка', icon: 'crop' },
  { id: 'adjust', label: 'Фильтры', icon: 'adjust' },
];

interface ToolbarProps {
  tool: TEditorTool | null;
  isReady: boolean;
  isSaving: boolean;
  /** Повторное нажатие на выбранный инструмент прячет полку — сюда придёт null. */
  onSetTool: (tool: TEditorTool | null) => void;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * Строка инструментов.
 *
 * Телефон: ✕ — четыре инструмента с подписями — ✓, в зоне большого пальца.
 * «Готово» нажимают при каждом редактировании, тянуться за ним наверх
 * неудобно. Выбранный инструмент — цветом иконки, а не заливкой: заливка
 * у «Готово», и действие не путается с режимом. Подписи — потому что
 * всплывающих подсказок на телефоне нет.
 *
 * Десктоп: сегмент вверху колонки, «Отмена» и «Готово» — внизу колонки
 * (EditorActions).
 */
export function EditorToolbar({
  tool,
  isReady,
  isSaving,
  onSetTool,
  onCancel,
  onSave,
}: ToolbarProps) {
  const { t } = useTranslation();
  const close = t('close', 'Закрыть');
  const done = t('done', 'Готово');

  return (
    <nav
      aria-label={t('photoEditor.tools', 'Инструменты')}
      className="grid grid-cols-[44px_repeat(4,minmax(0,1fr))_52px] items-center gap-0.5 px-3 pt-2 pb-safe-4 md:order-first md:grid-cols-4 md:gap-1 md:rounded-button md:bg-sheet-2 md:p-1"
    >
      <Button
        aria-label={close}
        className="md:hidden"
        iconOnly
        onClick={onCancel}
        title={close}
        variant="ghost"
      >
        <Icon name="cross" size="lg" />
      </Button>

      {TOOLS.map((item) => (
        <button
          aria-pressed={tool === item.id}
          className="flex cursor-pointer flex-col items-center gap-0.5 rounded-icon py-1.5 text-meta font-medium text-ink-3 transition-colors duration-fast hover:text-ink aria-pressed:text-brand md:rounded-field md:py-1.5 md:aria-pressed:bg-sheet md:aria-pressed:text-ink md:aria-pressed:shadow-[var(--elev-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          key={item.id}
          onClick={() => onSetTool(tool === item.id ? null : item.id)}
          type="button"
        >
          <Icon className="md:size-4.5" name={item.icon} size="lg" />
          <span>{t(`photoEditor.tool.${item.id}`, item.label)}</span>
        </button>
      ))}

      <Button
        aria-label={done}
        className="justify-self-end md:hidden"
        disabled={!isReady || isSaving}
        iconOnly
        loading={isSaving}
        onClick={onSave}
        shape="round"
        size="lg"
        title={done}
        variant="primary"
      >
        <Icon name="check" size="lg" />
      </Button>
    </nav>
  );
}

interface ActionsProps {
  isReady: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

/* Десктоп: внизу колонки, обычными кнопками с подписями. */
export function EditorActions({ isReady, isSaving, onCancel, onSave }: ActionsProps) {
  const { t } = useTranslation();
  return (
    <div className="hidden grid-cols-2 gap-2 pt-4 md:grid">
      <Button onClick={onCancel} variant="secondary">
        {t('cancel', 'Отмена')}
      </Button>
      <Button disabled={!isReady || isSaving} loading={isSaving} onClick={onSave}>
        {t('done', 'Готово')}
      </Button>
    </div>
  );
}
