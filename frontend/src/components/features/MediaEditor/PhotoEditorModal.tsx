import { Spinner } from '@/components/ui';
import { DEFAULT_CROP, DEFAULT_FILTERS } from '@/consts';
import {
  usePhotoEditorCanvas,
  usePhotoEditorCrop,
  usePhotoEditorDrawing,
  usePhotoEditorHistory,
} from '@/hooks';
import type {
  IEditorState,
  IPhotoEditorModalProps,
  TBrushType,
  TCropRatioValue,
  TEditorObject,
  TEditorTool,
  TTextFontId,
} from '@/types';
import { cn } from '@/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorCropOverlay } from './EditorCropOverlay';
import { EditorDrawPanel } from './EditorDrawPanel';
import { EditorFiltersPanel } from './EditorFiltersPanel';
import { EditorHistoryFloat } from './EditorHistoryFloat';
import { EditorTextOverlay } from './EditorTextOverlay';
import { EditorTextPanel } from './EditorTextPanel';
import { EditorToolbar } from './EditorToolbar';
import { EditorTransformPanel } from './EditorTransformPanel';

export function PhotoEditorModal({ file, onCancel, onSave }: IPhotoEditorModalProps) {
  const { t } = useTranslation();
  const [tool, setTool] = useState<TEditorTool>('draw');
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
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

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
  } = usePhotoEditorDrawing({
    canvasRef,
    tool,
    brushType,
    brushColor,
    brushSize,
    textFont,
    objects,
    setObjects,
    selectedId,
    setSelectedId,
    setEditingTextId,
    onCommit: commit,
    renderCanvas,
  });

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current?.();
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
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleteSelectedText, selectedId, tool]);

  return (
    <div className="fixed inset-0 z-[10000] bg-black text-white" role="presentation">
      <section
        aria-label={t('photoEditor', 'Редактор фотографии')}
        aria-modal="true"
        className="w-full h-screen h-[100dvh] grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_390px] bg-black overflow-hidden"
        role="dialog"
      >
        <div className="relative min-w-0 min-h-0 grid place-items-center p-3 md:p-8 bg-black">
          <EditorHistoryFloat
            canRedo={canRedo}
            canUndo={canUndo}
            onRedo={handleRedo}
            onUndo={handleUndo}
          />

          <div className="relative grid place-items-center max-w-full max-h-full overflow-hidden" ref={stageRef}>
            {!isReady && (
              <div className="absolute z-10 flex items-center gap-2 text-ink-3">
                <Spinner size="md" />
                <span>{t('loading', 'Загрузка…')}</span>
              </div>
            )}
            <canvas
              className={cn(
                'block max-w-full max-h-[calc(100dvh-320px)] md:max-h-[calc(100dvh-68px)] object-contain touch-none select-none shadow-[0_18px_60px_rgba(0,0,0,0.45)]',
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
                inlineTextRef={inlineTextRef}
                onBlur={() => {
                  commit();
                  setEditingTextId(null);
                }}
                onChange={(value) => updateSelectedText({ text: value })}
                onDelete={deleteSelectedText}
                selectedTextObject={selectedTextObject}
              />
            )}
            {tool === 'transform' && isReady && (
              <EditorCropOverlay crop={crop} onCropPointerDown={handleCropPointerDown} />
            )}
          </div>
        </div>

        <aside className="min-h-0 grid grid-rows-[minmax(0,1fr)_auto] max-h-[310px] md:max-h-none bg-sheet-2 border-t md:border-t-0 md:border-l border-line p-4 md:p-6 rounded-t-window md:rounded-none">
          <div className="overflow-y-auto overflow-x-hidden px-2 py-1 max-h-[190px] md:max-h-none flex flex-col gap-4">
            {tool === 'draw' && (
              <EditorDrawPanel
                brushColor={brushColor}
                brushSize={brushSize}
                brushType={brushType}
                onBrushSizeChange={setBrushSize}
                onBrushTypeChange={setBrushType}
                onColorChange={setBrushColor}
              />
            )}
            {tool === 'text' && (
              <EditorTextPanel
                brushColor={brushColor}
                onAddText={addText}
                onColorChange={setBrushColor}
                onCommit={commit}
                onDeleteText={deleteSelectedText}
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
                onCommitFilters={commit}
                onResetFilters={() => {
                  setFilters(DEFAULT_FILTERS);
                  commit({ filters: DEFAULT_FILTERS });
                }}
                onUpdateFilter={(name, value) =>
                  setFilters((current) => ({ ...current, [name]: value }))
                }
              />
            )}
          </div>

          <EditorToolbar
            isReady={isReady}
            isSaving={isSaving}
            onCancel={onCancel}
            onSave={saveImage}
            onSetTool={setTool}
            tool={tool}
          />
        </aside>
      </section>
    </div>
  );
}
