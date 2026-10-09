import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testI18n } from '@/test/harness/i18n';
import { DEFAULT_FILTERS } from '../model/config';
import type { IEditorTextObject } from '../model/types';
import { EditorRange } from './EditorControls';
import { EditorCropOverlay } from './EditorCropOverlay';
import { EditorDrawPanel } from './EditorDrawPanel';
import { EditorFiltersPanel } from './EditorFiltersPanel';
import { EditorSizeSlider } from './EditorSizeSlider';
import { EditorTextHandles } from './EditorTextHandles';
import { EditorTextOverlay } from './EditorTextOverlay';
import { EditorTextPanel } from './EditorTextPanel';
import { EditorActions, EditorToolbar } from './EditorToolbar';
import { EditorTopBar } from './EditorTopBar';
import { EditorTransformPanel } from './EditorTransformPanel';
import { PhotoEditorModal } from './PhotoEditorModal';

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={testI18n}>{ui}</I18nextProvider>);
}

const textObject: IEditorTextObject = {
  id: 'txt-1',
  type: 'text',
  text: 'Привет',
  x: 0.5,
  y: 0.5,
  size: 40,
  color: '#ffffff',
  font: 'modern',
  rotation: 0,
};

describe('редактор фото', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('EditorToolbar', () => {
    it('выбирает инструмент, а повторное нажатие прячет полку', async () => {
      const onSetTool = vi.fn();

      const { rerender } = renderWithI18n(
        <EditorToolbar
          isReady
          isSaving={false}
          onCancel={vi.fn()}
          onSave={vi.fn()}
          onSetTool={onSetTool}
          tool={null}
        />
      );

      for (const name of ['Кисть', 'Текст', 'Обрезка', 'Фильтры']) {
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
      }

      await userEvent.click(screen.getByRole('button', { name: 'Обрезка' }));
      expect(onSetTool).toHaveBeenLastCalledWith('transform');

      rerender(
        <I18nextProvider i18n={testI18n}>
          <EditorToolbar
            isReady
            isSaving={false}
            onCancel={vi.fn()}
            onSave={vi.fn()}
            onSetTool={onSetTool}
            tool="transform"
          />
        </I18nextProvider>
      );

      const crop = screen.getByRole('button', { name: 'Обрезка' });
      expect(crop).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(crop);
      expect(onSetTool).toHaveBeenLastCalledWith(null);
    });

    it('закрывает и сохраняет кнопками в углах; «Готово» ждёт загрузки фото', async () => {
      const onCancel = vi.fn();
      const onSave = vi.fn();

      const { rerender } = renderWithI18n(
        <EditorToolbar
          isReady={false}
          isSaving={false}
          onCancel={onCancel}
          onSave={onSave}
          onSetTool={vi.fn()}
          tool={null}
        />
      );

      expect(screen.getByRole('button', { name: 'Готово' })).toBeDisabled();

      rerender(
        <I18nextProvider i18n={testI18n}>
          <EditorToolbar
            isReady
            isSaving={false}
            onCancel={onCancel}
            onSave={onSave}
            onSetTool={vi.fn()}
            tool={null}
          />
        </I18nextProvider>
      );

      await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
      expect(onCancel).toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Готово' }));
      expect(onSave).toHaveBeenCalled();
    });
  });

  describe('EditorActions', () => {
    it('даёт «Отмена» и «Готово» с подписями для колонки десктопа', async () => {
      const onCancel = vi.fn();
      const onSave = vi.fn();

      renderWithI18n(
        <EditorActions isReady isSaving={false} onCancel={onCancel} onSave={onSave} />
      );

      await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
      await userEvent.click(screen.getByRole('button', { name: 'Готово' }));
      expect(onCancel).toHaveBeenCalled();
      expect(onSave).toHaveBeenCalled();
    });
  });

  describe('EditorTopBar', () => {
    it('блокирует отмену и повтор, когда их нет, и показывает «Сбросить» только по делу', async () => {
      const onUndo = vi.fn();
      const onRedo = vi.fn();
      const onReset = vi.fn();

      const { rerender } = renderWithI18n(
        <EditorTopBar canRedo={false} canUndo={false} onRedo={onRedo} onUndo={onUndo} />
      );

      expect(screen.getByRole('button', { name: 'Отменить' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Сбросить' })).not.toBeInTheDocument();

      rerender(
        <I18nextProvider i18n={testI18n}>
          <EditorTopBar canRedo canUndo onRedo={onRedo} onReset={onReset} onUndo={onUndo} />
        </I18nextProvider>
      );

      await userEvent.click(screen.getByRole('button', { name: 'Отменить' }));
      await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
      expect(onUndo).toHaveBeenCalled();
      expect(onRedo).toHaveBeenCalled();
      expect(onReset).toHaveBeenCalled();
    });
  });

  describe('EditorDrawPanel', () => {
    it('выбирает кисть и цвет', async () => {
      const onColorChange = vi.fn();
      const onBrushTypeChange = vi.fn();

      renderWithI18n(
        <EditorDrawPanel
          brushColor="#ff4b3e"
          brushType="pen"
          onBrushTypeChange={onBrushTypeChange}
          onColorChange={onColorChange}
        />
      );

      expect(screen.getByRole('button', { name: 'Перо' })).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(screen.getByRole('button', { name: 'Маркер' }));
      expect(onBrushTypeChange).toHaveBeenCalledWith('marker');

      await userEvent.click(screen.getByRole('button', { name: '#4cd964' }));
      expect(onColorChange).toHaveBeenCalledWith('#4cd964');
    });
  });

  describe('EditorTextPanel', () => {
    it('добавляет текст и меняет шрифт выбранного текста', async () => {
      const onAddText = vi.fn();
      const onFontChange = vi.fn();
      const onUpdateSelectedText = vi.fn();

      renderWithI18n(
        <EditorTextPanel
          brushColor="#1689ff"
          onAddText={onAddText}
          onColorChange={vi.fn()}
          onFontChange={onFontChange}
          onUpdateSelectedText={onUpdateSelectedText}
          selectedTextObject={textObject}
          textFont="modern"
        />
      );

      const add = screen.getByRole('button', { name: 'Добавить текст' });
      expect(add).not.toHaveAttribute('aria-pressed');
      await userEvent.click(add);
      expect(onAddText).toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Serif' }));
      expect(onFontChange).toHaveBeenCalledWith('serif');
      expect(onUpdateSelectedText).toHaveBeenCalledWith({ font: 'serif' }, true);
    });
  });

  describe('EditorTransformPanel', () => {
    it('поворачивает, отражает и ставит пропорции', async () => {
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

      await userEvent.click(screen.getByRole('button', { name: 'Повернуть' }));
      expect(onRotate).toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Отразить по горизонтали' }));
      expect(onFlip).toHaveBeenCalledWith('x');

      await userEvent.click(screen.getByRole('button', { name: 'Отразить по вертикали' }));
      expect(onFlip).toHaveBeenCalledWith('y');

      expect(screen.getByRole('button', { name: 'Произвольно' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await userEvent.click(screen.getByRole('button', { name: 'Квадрат' }));
      expect(onSelectRatio).toHaveBeenCalledWith(1);
    });
  });

  describe('EditorFiltersPanel', () => {
    it('выбирает параметр чипом; ползунков по одному на параметр', async () => {
      renderWithI18n(
        <EditorFiltersPanel
          filters={DEFAULT_FILTERS}
          onCommitFilters={vi.fn()}
          onUpdateFilter={vi.fn()}
        />
      );

      for (const name of ['Яркость', 'Контраст', 'Насыщенность', 'Сепия', 'Размытие']) {
        expect(screen.getByRole('slider', { name })).toBeInTheDocument();
      }

      const contrast = screen.getByRole('button', { name: 'Контраст' });
      expect(contrast).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(contrast);
      expect(contrast).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Яркость' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });
  });

  describe('EditorRange', () => {
    it('с нейтральным значением показывает сдвиг со знаком', () => {
      renderWithI18n(
        <EditorRange
          label="Яркость"
          max={200}
          min={0}
          neutral={100}
          onChange={vi.fn()}
          value={112}
        />
      );
      expect(screen.getByText('+12')).toBeInTheDocument();
      expect(screen.getByRole('slider', { name: 'Яркость' })).toHaveAttribute(
        'aria-valuetext',
        '+12'
      );
    });

    it('без нейтрального — значение с единицей', () => {
      renderWithI18n(
        <EditorRange label="Размытие" max={20} min={0} onChange={vi.fn()} suffix="px" value={4} />
      );
      expect(screen.getByText('4px')).toBeInTheDocument();
    });

    it('сообщает о конце изменения один раз и без аргументов', () => {
      const onAfterChange = vi.fn();
      renderWithI18n(
        <EditorRange
          label="Яркость"
          max={200}
          min={0}
          neutral={100}
          onAfterChange={onAfterChange}
          onChange={vi.fn()}
          value={100}
        />
      );
      const slider = screen.getByRole('slider', { name: 'Яркость' });

      // Палец отпущен: на телефоне приходят и pointerup, и touchend — это ещё не конец
      // изменения, иначе один жест писал в историю два шага.
      fireEvent.pointerUp(slider);
      fireEvent.touchEnd(slider);
      expect(onAfterChange).not.toHaveBeenCalled();

      // Конец изменения — change. Событие наружу не уходит: commit(patch) принимал
      // его за изменения, и копирование истории падало на циклической ссылке.
      fireEvent.change(slider, { target: { value: '120' } });
      expect(onAfterChange).toHaveBeenCalledTimes(1);
      expect(onAfterChange).toHaveBeenCalledWith();
    });
  });

  describe('EditorSizeSlider', () => {
    it('вертикальный ползунок меняется стрелками и упирается в границы', () => {
      const onChange = vi.fn();
      const onCommit = vi.fn();

      renderWithI18n(
        <EditorSizeSlider
          label="Размер кисти"
          max={80}
          min={1}
          onChange={onChange}
          onCommit={onCommit}
          value={80}
        />
      );

      const slider = screen.getByRole('slider', { name: 'Размер кисти' });
      expect(slider).toHaveAttribute('aria-orientation', 'vertical');
      expect(slider).toHaveAttribute('aria-valuenow', '80');

      fireEvent.keyDown(slider, { key: 'ArrowDown' });
      expect(onChange).toHaveBeenLastCalledWith(79);
      expect(onCommit).toHaveBeenCalled();

      fireEvent.keyDown(slider, { key: 'PageUp' });
      expect(onChange).toHaveBeenLastCalledWith(80);

      fireEvent.keyDown(slider, { key: 'Home' });
      expect(onChange).toHaveBeenLastCalledWith(1);
    });
  });

  describe('оверлеи на фото', () => {
    it('рамка обрезки — область с уголками', () => {
      renderWithI18n(
        <EditorCropOverlay
          crop={{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }}
          onCropPointerDown={vi.fn()}
        />
      );

      expect(screen.getByRole('region', { name: 'Рамка обрезки' })).toBeInTheDocument();
    });

    it('поле ввода текста поверх фото', () => {
      renderWithI18n(
        <EditorTextOverlay
          canvasDisplayWidth={800}
          inlineTextRef={{ current: null }}
          onBlur={vi.fn()}
          onChange={vi.fn()}
          selectedTextObject={textObject}
        />
      );

      expect(screen.getByRole('textbox', { name: 'Текст на изображении' })).toHaveValue('Привет');
    });

    it('ручки над текстом: повернуть и удалить', async () => {
      const onRotateStart = vi.fn();
      const onDelete = vi.fn();

      renderWithI18n(
        <EditorTextHandles
          canvasDisplayWidth={800}
          onDelete={onDelete}
          onRotateStart={onRotateStart}
          selectedTextObject={textObject}
        />
      );

      fireEvent.pointerDown(screen.getByRole('button', { name: 'Повернуть текст' }));
      expect(onRotateStart).toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Удалить текст' }));
      expect(onDelete).toHaveBeenCalled();
    });
  });

  describe('PhotoEditorModal', () => {
    const file = new File(['mock-image-content'], 'test-photo.jpg', { type: 'image/jpeg' });

    it('открывается без выбранного инструмента', async () => {
      renderWithI18n(<PhotoEditorModal file={file} onCancel={vi.fn()} onSave={vi.fn()} />);

      expect(screen.getByRole('dialog', { name: 'Редактор фотографии' })).toBeInTheDocument();
      for (const name of ['Кисть', 'Текст', 'Обрезка', 'Фильтры']) {
        expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
      }

      const brush = screen.getByRole('button', { name: 'Кисть' });
      await userEvent.click(brush);
      expect(brush).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Маркер' })).toBeInTheDocument();

      await userEvent.click(brush);
      expect(brush).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByRole('button', { name: 'Маркер' })).not.toBeInTheDocument();
    });

    it('без правок закрывается сразу, без вопроса', async () => {
      const onCancel = vi.fn();
      renderWithI18n(<PhotoEditorModal file={file} onCancel={onCancel} onSave={vi.fn()} />);

      await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      // Окно подтверждения в разметке есть всегда (<dialog>), но не открыто.
      expect(screen.getByText('Выйти без сохранения?').closest('dialog')).not.toHaveAttribute(
        'open'
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledTimes(2);
    });
  });
});
