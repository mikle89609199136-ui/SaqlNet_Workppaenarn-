import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { DEFAULT_FILTERS } from '@/consts';
import { EditorCropOverlay } from './EditorCropOverlay';
import { EditorDrawPanel } from './EditorDrawPanel';
import { EditorFiltersPanel } from './EditorFiltersPanel';
import { EditorHistoryFloat } from './EditorHistoryFloat';
import { EditorTextOverlay } from './EditorTextOverlay';
import { EditorTextPanel } from './EditorTextPanel';
import { EditorToolbar } from './EditorToolbar';
import { EditorTransformPanel } from './EditorTransformPanel';
import { PhotoEditorModal } from './PhotoEditorModal';

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

describe('компоненты MediaEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('EditorToolbar', () => {
    it('переключает инструменты и вызывает колбэки закрытия и сохранения', async () => {
      const onSetTool = vi.fn();
      const onCancel = vi.fn();
      const onSave = vi.fn();

      renderWithI18n(
        <EditorToolbar
          isReady={true}
          isSaving={false}
          onCancel={onCancel}
          onSave={onSave}
          onSetTool={onSetTool}
          tool="draw"
        />
      );

      const textBtn = screen.getByRole('button', { name: /текст/i });
      await userEvent.click(textBtn);
      expect(onSetTool).toHaveBeenCalledWith('text');

      const transformBtn = screen.getByRole('button', { name: /размер и обрезка/i });
      await userEvent.click(transformBtn);
      expect(onSetTool).toHaveBeenCalledWith('transform');

      const adjustBtn = screen.getByRole('button', { name: /фильтры/i });
      await userEvent.click(adjustBtn);
      expect(onSetTool).toHaveBeenCalledWith('adjust');

      const cancelBtn = screen.getByRole('button', { name: /закрыть/i });
      await userEvent.click(cancelBtn);
      expect(onCancel).toHaveBeenCalled();

      const saveBtn = screen.getByRole('button', { name: /сохранить/i });
      await userEvent.click(saveBtn);
      expect(onSave).toHaveBeenCalled();
    });
  });

  describe('EditorHistoryFloat', () => {
    it('блокирует кнопки когда отмена или повтор недоступны', async () => {
      const onUndo = vi.fn();
      const onRedo = vi.fn();

      const { rerender } = renderWithI18n(
        <EditorHistoryFloat canRedo={false} canUndo={false} onRedo={onRedo} onUndo={onUndo} />
      );

      const undoBtn = screen.getByRole('button', { name: /отменить/i });
      const redoBtn = screen.getByRole('button', { name: /повторить/i });

      expect(undoBtn).toBeDisabled();
      expect(redoBtn).toBeDisabled();

      rerender(
        <I18nextProvider i18n={testI18n}>
          <EditorHistoryFloat canRedo={true} canUndo={true} onRedo={onRedo} onUndo={onUndo} />
        </I18nextProvider>
      );

      expect(undoBtn).not.toBeDisabled();
      expect(redoBtn).not.toBeDisabled();

      await userEvent.click(undoBtn);
      expect(onUndo).toHaveBeenCalled();

      await userEvent.click(redoBtn);
      expect(onRedo).toHaveBeenCalled();
    });
  });

  describe('EditorDrawPanel', () => {
    it('позволяет выбирать кисть и цвет', async () => {
      const onColorChange = vi.fn();
      const onBrushTypeChange = vi.fn();
      const onBrushSizeChange = vi.fn();

      renderWithI18n(
        <EditorDrawPanel
          brushColor="#ff4b3e"
          brushSize={8}
          brushType="pen"
          onBrushSizeChange={onBrushSizeChange}
          onBrushTypeChange={onBrushTypeChange}
          onColorChange={onColorChange}
        />
      );

      const markerBtn = screen.getByTitle('Маркер');
      await userEvent.click(markerBtn);
      expect(onBrushTypeChange).toHaveBeenCalledWith('marker');

      const greenColorBtn = screen.getByRole('button', { name: '#4cd964' });
      await userEvent.click(greenColorBtn);
      expect(onColorChange).toHaveBeenCalledWith('#4cd964');
    });
  });

  describe('EditorTextPanel', () => {
    it('содержит кнопку добавления текста и выбора шрифта', async () => {
      const onAddText = vi.fn();
      const onDeleteText = vi.fn();
      const onColorChange = vi.fn();
      const onFontChange = vi.fn();
      const onUpdateSelectedText = vi.fn();
      const onCommit = vi.fn();

      renderWithI18n(
        <EditorTextPanel
          brushColor="#1689ff"
          onAddText={onAddText}
          onColorChange={onColorChange}
          onCommit={onCommit}
          onDeleteText={onDeleteText}
          onFontChange={onFontChange}
          onUpdateSelectedText={onUpdateSelectedText}
          selectedTextObject={null}
          textFont="modern"
        />
      );

      const addBtn = screen.getByRole('button', { name: /добавить по центру/i });
      await userEvent.click(addBtn);
      expect(onAddText).toHaveBeenCalled();

      const serifBtn = screen.getByRole('button', { name: 'Serif' });
      await userEvent.click(serifBtn);
      expect(onFontChange).toHaveBeenCalledWith('serif');
    });
  });

  describe('EditorTransformPanel', () => {
    it('вызывает поворот, отражение и установку пропорций', async () => {
      const onRotate = vi.fn();
      const onFlip = vi.fn();
      const onSelectRatio = vi.fn();

      renderWithI18n(
        <EditorTransformPanel
          cropRatio={null}
          onFlip={onFlip}
          onRotate={onRotate}
          onSelectRatio={onSelectRatio}
        />
      );

      const rotateBtn = screen.getByTitle('Повернуть');
      await userEvent.click(rotateBtn);
      expect(onRotate).toHaveBeenCalled();

      const flipXBtn = screen.getByTitle('Отразить по горизонтали');
      await userEvent.click(flipXBtn);
      expect(onFlip).toHaveBeenCalledWith('x');

      const flipYBtn = screen.getByTitle('Отразить по вертикали');
      await userEvent.click(flipYBtn);
      expect(onFlip).toHaveBeenCalledWith('y');

      const squareBtn = screen.getByRole('button', { name: 'Квадрат' });
      await userEvent.click(squareBtn);
      expect(onSelectRatio).toHaveBeenCalledWith(1);
    });
  });

  describe('EditorFiltersPanel', () => {
    it('отображает ползунки фильтров и кнопку сброса', async () => {
      const onUpdateFilter = vi.fn();
      const onCommitFilters = vi.fn();
      const onResetFilters = vi.fn();

      renderWithI18n(
        <EditorFiltersPanel
          filters={DEFAULT_FILTERS}
          onCommitFilters={onCommitFilters}
          onResetFilters={onResetFilters}
          onUpdateFilter={onUpdateFilter}
        />
      );

      expect(screen.getByText('Яркость')).toBeInTheDocument();
      expect(screen.getByText('Контраст')).toBeInTheDocument();
      expect(screen.getByText('Насыщенность')).toBeInTheDocument();
      expect(screen.getByText('Сепия')).toBeInTheDocument();
      expect(screen.getByText('Размытие')).toBeInTheDocument();

      const resetBtn = screen.getByRole('button', { name: /сбросить/i });
      await userEvent.click(resetBtn);
      expect(onResetFilters).toHaveBeenCalled();
    });
  });

  describe('EditorCropOverlay and EditorTextOverlay', () => {
    it('рендерит рамку кропа с хэндлами', () => {
      const onCropPointerDown = vi.fn();
      renderWithI18n(
        <EditorCropOverlay
          crop={{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }}
          onCropPointerDown={onCropPointerDown}
        />
      );

      expect(screen.getByRole('region', { name: /рамка обрезки/i })).toBeInTheDocument();
    });

    it('рендерит оверлей инлайн-текста с кнопкой удаления', async () => {
      const onBlur = vi.fn();
      const onChange = vi.fn();
      const onDelete = vi.fn();
      const inlineRef = { current: null };

      renderWithI18n(
        <EditorTextOverlay
          canvasDisplayWidth={800}
          inlineTextRef={inlineRef}
          onBlur={onBlur}
          onChange={onChange}
          onDelete={onDelete}
          selectedTextObject={{
            id: 'txt-1',
            type: 'text',
            text: 'Привет',
            x: 0.5,
            y: 0.5,
            size: 40,
            color: '#ffffff',
            font: 'modern',
            rotation: 0,
          }}
        />
      );

      const textarea = screen.getByRole('textbox', { name: /текст на изображении/i });
      expect(textarea).toHaveValue('Привет');

      const deleteBtn = screen.getByRole('button', { name: /удалить текст/i });
      await userEvent.click(deleteBtn);
      expect(onDelete).toHaveBeenCalled();
    });
  });

  describe('PhotoEditorModal integration', () => {
    it('рендерит модалку редактора фото с доступными инструментами', () => {
      const file = new File(['mock-image-content'], 'test-photo.jpg', { type: 'image/jpeg' });
      const onCancel = vi.fn();
      const onSave = vi.fn();

      renderWithI18n(<PhotoEditorModal file={file} onCancel={onCancel} onSave={onSave} />);

      expect(screen.getByRole('dialog', { name: /редактор фотографии/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /кисть/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /текст/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /размер и обрезка/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /фильтры/i })).toBeInTheDocument();
    });
  });
});
