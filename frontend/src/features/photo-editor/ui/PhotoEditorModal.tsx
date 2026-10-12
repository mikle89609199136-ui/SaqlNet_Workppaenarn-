import { ConfirmDialog, Spinner } from '@/shared/ui';
import { DEFAULT_CROP, DEFAULT_FILTERS } from '../model/config';
import { usePhotoEditorCanvas } from '../model/usePhotoEditorCanvas';
import { usePhotoEditorCrop } from '../model/usePhotoEditorCrop';
import { usePhotoEditorDrawing } from '../model/usePhotoEditorDrawing';
import { usePhotoEditorHistory } from '../model/usePhotoEditorHistory';
import type {
  IEditorFilter,
  IEditorState,
  IPhotoEditorModalProps,
  TBrushType,
  TCropRatioValue,
  TEditorObject,
  TEditorTool,
  TTextFontId,
} from '../model/types';
import { cn } from '@/shared/lib';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorCropOverlay } from './EditorCropOverlay';
import { EditorDrawPanel } from './EditorDrawPanel';
import { EditorFiltersPanel } from './EditorFiltersPanel';
import { EditorSizeSlider } from './EditorSizeSlider';
import { EditorTextHandlePill, EditorTextHandles } from './EditorTextHandles';
import { EditorTextOverlay } from './EditorTextOverlay';
import { EditorTextPanel } from './EditorTextPanel';
import { EditorActions, EditorToolbar } from './EditorToolbar';
import { EditorTopBar } from './EditorTopBar';
import { EditorTransformPanel } from './EditorTransformPanel';

const FILTER_NAMES = Object.keys(DEFAULT_FILTERS) as Array<keyof IEditorFilter>;

/**
 * Редактор фото перед отправкой — раскладка «A+» (макеты в задаче):
 *
 * - открывается без выбранного инструмента: фото крупно, внизу одна строка,
 *   случайное касание снимка не оставляет штрих;
 * - полка настроек выезжает по нажатию на инструмент и прячется повторным;
 *   в ней не больше двух строк на любой вкладке;
 * - ✕ и ✓ — в нижних углах, у большого пальца; отмена и «Сбросить» — сверху;
 * - размер кисти и текста — клином у края фото, поворот текста — ручкой;
 * - на десктопе — правая колонка, где ничего не прячется.
 */
export function PhotoEditorModal({ file, onCancel, onSave }: IPhotoEditorModalProps) {
  const { t } = useTranslation();
  const [tool, setTool] = useState<TEditorTool | null>(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(1);
  const [flipY, setFlipY] = useState(1);
  const [crop, setCrop] = useState(DEFAULT_CROP);
  const [cropRatio, setCropRatio] = useState<TCropRatioValue>(null);
  const [objects, setObjects] = useState<TEditorObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brushType, setBrushType] = useState<TBrushType>('pen');
  const [brushColor, setBrushColor] = useState('#ff4b3e');
  const [brushSize, setBrushSize] = useState(8);
  const [textFont, setTextFont] = useState<TTextFontId>('modern');
  const [textSize, setTextSize] = useState(64);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);

  const inlineTextRef = useRef<HTMLTextAreaElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const currentState = useMemo<IEditorState>(
    () => ({ filters, rotation, flipX, flipY, crop, cropRatio, objects }),
    [crop, cropRatio, filters, flipX, flipY, objects, rotation]
  );
  const stateRef = useRef<IEditorState>(currentState);
  useEffect(() => {
    stateRef.current = currentState;
  }, [currentState]);

  const selectedObject = useMemo(
    () => objects.find((item) => item.id === selectedId) || null,
    [objects, selectedId]
  );
  const selectedTextObject = useMemo(
    () => (selectedObject?.type === 'text' ? selectedObject : null),
    [selectedObject]
  );

  const { isReady, isSaving, canvasRef, stageRef, canvasDisplayWidth, renderCanvas, saveImage } =
    usePhotoEditorCanvas({
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
    });

  const { pushHistory, canUndo, canRedo, undo, redo } = usePhotoEditorHistory(file, isReady);

  const commit = useCallback(
    (patch: Partial<IEditorState> = {}) => {
      const next = { ...stateRef.current, ...patch };
      pushHistory(next);
    },
    [pushHistory]
  );

  const applySnapshot = useCallback((snapshot: IEditorState) => {
    setFilters(snapshot.filters);
    setRotation(snapshot.rotation);
    setFlipX(snapshot.flipX);
    setFlipY(snapshot.flipY);
    setCrop(snapshot.crop);
    setCropRatio(snapshot.cropRatio);
    setObjects(snapshot.objects);
    setSelectedId(null);
  }, []);

  const handleUndo = useCallback(() => undo(applySnapshot), [undo, applySnapshot]);
  const handleRedo = useCallback(() => redo(applySnapshot), [redo, applySnapshot]);

  const { rotateImage, flipImage, selectRatio, handleCropPointerDown } = usePhotoEditorCrop({
    canvasRef,
    stageRef,
    crop,
    setCrop,
    cropRatio,
    setCropRatio,
    rotation,
    setRotation,
    flipX,
    setFlipX,
    flipY,
    setFlipY,
    onCommit: commit,
  });

  const {
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    addText,
    updateSelectedText,
    deleteSelectedText,
    handleTextRotateStart,
  } = usePhotoEditorDrawing({
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
    onCommit: commit,
    renderCanvas,
  });

  // Новый или выбранный текст — сразу в поле ввода, курсор в конце: иначе
  // после «+ Текст» приходилось ещё раз попадать пальцем в рамку.
  useEffect(() => {
    if (!editingTextId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const field = inlineTextRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingTextId]);

  // Закрыть с правками — только после подтверждения: крестик стоит рядом с
  // инструментами, и задеть его легко. Без правок закрываемся сразу.
  const requestClose = useCallback(() => {
    if (canUndo) setIsConfirmingClose(true);
    else onCancelRef.current?.();
  }, [canUndo]);

  const isTransformChanged =
    rotation % 360 !== 0 ||
    flipX !== 1 ||
    flipY !== 1 ||
    cropRatio !== null ||
    crop.x !== DEFAULT_CROP.x ||
    crop.y !== DEFAULT_CROP.y ||
    crop.width !== DEFAULT_CROP.width ||
    crop.height !== DEFAULT_CROP.height;
  const isFiltersChanged = FILTER_NAMES.some((name) => filters[name] !== DEFAULT_FILTERS[name]);

  const resetTransform = useCallback(() => {
    setRotation(0);
    setFlipX(1);
    setFlipY(1);
    setCrop(DEFAULT_CROP);
    setCropRatio(null);
    commit({ rotation: 0, flipX: 1, flipY: 1, crop: DEFAULT_CROP, cropRatio: null });
  }, [commit]);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    commit({ filters: DEFAULT_FILTERS });
  }, [commit]);

  let onReset: (() => void) | undefined;
  if (tool === 'transform' && isTransformChanged) onReset = resetTransform;
  if (tool === 'adjust' && isFiltersChanged) onReset = resetFilters;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape в окне подтверждения закрывает само окно — это его дело.
      if (event.key === 'Escape' && !isConfirmingClose) requestClose();
      const target = event.target;
      const isEditingField =
        target instanceof HTMLElement &&
        (target.matches('input, textarea, [contenteditable="true"]') || target.isContentEditable);
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedId &&
        tool === 'text' &&
        !isEditingField
      ) {
        event.preventDefault();
        deleteSelectedText();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedText, isConfirmingClose, requestClose, selectedId, tool]);

  return (
    <div className="fixed inset-0 z-[10000] bg-black text-on-scrim" role="presentation">
      <section
        aria-label={t('photoEditor', 'Редактор фотографии')}
        aria-modal="true"
        className="w-full h-screen h-[100dvh] grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_360px] md:grid-rows-[auto_minmax(0,1fr)] bg-black overflow-hidden"
        role="dialog"
      >
        <EditorTopBar
          canRedo={canRedo}
          canUndo={canUndo}
          onRedo={handleRedo}
          onReset={onReset}
          onUndo={handleUndo}
        />

        {/* Поле фото — контейнер по размеру: холст вписывается в то, что
            осталось от полки (100cqw × 100cqh), и плавно уменьшается, когда
            полка выезжает. Обрезано по краю — затемнение вокруг рамки
            обрезки не ложится на полку. */}
        <div className="relative min-w-0 min-h-0 grid place-items-center overflow-hidden px-3 pt-1 pb-3 md:p-8 [container-type:size]">
          <div className="relative grid place-items-center" ref={stageRef}>
            {!isReady && (
              <div className="absolute z-10 flex items-center gap-2 text-on-scrim">
                <Spinner size="md" />
                <span>{t('loading', 'Загрузка…')}</span>
              </div>
            )}
            <canvas
              className={cn(
                'block max-w-[100cqw] max-h-[100cqh] object-contain touch-none select-none',
                tool === 'draw' && 'cursor-crosshair',
                tool === 'text' && 'cursor-move'
              )}
              onPointerCancel={handleCanvasPointerUp}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              ref={canvasRef}
            />
            {tool === 'text' && selectedTextObject && editingTextId === selectedTextObject.id && (
              <EditorTextOverlay
                canvasDisplayWidth={canvasDisplayWidth}
                handles={
                  <EditorTextHandlePill
                    onDelete={deleteSelectedText}
                    onRotateStart={handleTextRotateStart}
                  />
                }
                inlineTextRef={inlineTextRef}
                onBlur={() => {
                  commit();
                  setEditingTextId(null);
                }}
                onChange={(value) => updateSelectedText({ text: value })}
                selectedTextObject={selectedTextObject}
              />
            )}
            {tool === 'text' && selectedTextObject && editingTextId !== selectedTextObject.id && (
              <EditorTextHandles
                canvasDisplayWidth={canvasDisplayWidth}
                onDelete={deleteSelectedText}
                onRotateStart={handleTextRotateStart}
                selectedTextObject={selectedTextObject}
              />
            )}
            {tool === 'transform' && isReady && (
              <EditorCropOverlay crop={crop} onCropPointerDown={handleCropPointerDown} />
            )}
          </div>

          {isReady && tool === 'draw' && (
            <EditorSizeSlider
              label={t('photoEditor.brushSize', 'Размер кисти')}
              max={80}
              min={1}
              onChange={setBrushSize}
              value={brushSize}
            />
          )}
          {isReady && tool === 'text' && (
            <EditorSizeSlider
              label={t('photoEditor.textSize', 'Размер текста')}
              max={180}
              min={20}
              onChange={(value) => {
                setTextSize(value);
                if (selectedTextObject) updateSelectedText({ size: value });
              }}
              onCommit={() => selectedTextObject && commit()}
              value={selectedTextObject?.size ?? textSize}
            />
          )}
        </div>

        <aside className="min-w-0 min-h-0 flex flex-col bg-sheet text-ink rounded-t-window md:rounded-none md:border-l md:border-line-soft md:p-5">
          {/* На телефоне полка выезжает, только когда выбран инструмент
              (0fr → 1fr). На десктопе она всегда раскрыта. */}
          <div
            className="grid grid-rows-[1fr] max-md:data-[open=false]:grid-rows-[0fr] transition-[grid-template-rows] duration-[280ms] ease-out motion-reduce:transition-none md:flex-1 md:min-h-0"
            data-open={tool !== null}
          >
            <div className="min-h-0 overflow-hidden md:overflow-y-auto">
              <div className="px-4 pt-3.5 pb-1 md:px-0 md:pt-5 md:pb-0">
                {tool === null && (
                  <p className="m-0 hidden text-ui text-ink-3 md:block">
                    {t(
                      'photoEditor.chooseTool',
                      'Выберите инструмент: кисть, текст, обрезка или фильтры.'
                    )}
                  </p>
                )}
                {tool === 'draw' && (
                  <EditorDrawPanel
                    brushColor={brushColor}
                    brushType={brushType}
                    onBrushTypeChange={setBrushType}
                    onColorChange={setBrushColor}
                  />
                )}
                {tool === 'text' && (
                  <EditorTextPanel
                    brushColor={brushColor}
                    onAddText={addText}
                    onColorChange={setBrushColor}
                    onFontChange={setTextFont}
                    onUpdateSelectedText={updateSelectedText}
                    selectedTextObject={selectedTextObject}
                    textFont={textFont}
                  />
                )}
                {tool === 'transform' && (
                  <EditorTransformPanel
                    cropRatio={cropRatio}
                    onFlip={flipImage}
                    onRotate={rotateImage}
                    onSelectRatio={selectRatio}
                  />
                )}
                {tool === 'adjust' && (
                  <EditorFiltersPanel
                    filters={filters}
                    onCommitFilters={() => commit()}
                    onUpdateFilter={(name, value) =>
                      setFilters((current) => ({ ...current, [name]: value }))
                    }
                  />
                )}
              </div>
            </div>
          </div>

          <EditorToolbar
            isReady={isReady}
            isSaving={isSaving}
            onCancel={requestClose}
            onSave={saveImage}
            onSetTool={setTool}
            tool={tool}
          />
          <EditorActions
            isReady={isReady}
            isSaving={isSaving}
            onCancel={requestClose}
            onSave={saveImage}
          />
        </aside>
      </section>

      <ConfirmDialog
        cancelLabel={t('photoEditor.discard.cancel', 'Продолжить')}
        confirmLabel={t('photoEditor.discard.confirm', 'Выйти')}
        danger
        onCancel={() => setIsConfirmingClose(false)}
        onConfirm={() => {
          setIsConfirmingClose(false);
          onCancelRef.current?.();
        }}
        open={isConfirmingClose}
        title={t('photoEditor.discard.title', 'Выйти без сохранения?')}
      >
        {t('photoEditor.discard.text', 'Рисунок, текст и обрезка на этом фото пропадут.')}
      </ConfirmDialog>
    </div>
  );
}
