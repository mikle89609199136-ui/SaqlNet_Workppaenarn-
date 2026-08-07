import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './PhotoEditorModal.css';
import { useTranslation } from 'react-i18next';

const DEFAULT_FILTERS = { brightness: 100, contrast: 100, saturate: 100, sepia: 0, blur: 0 };
const DEFAULT_CROP = { x: 0, y: 0, width: 1, height: 1 };
const COLORS = ['#ff4b3e', '#ffcc00', '#4cd964', '#1689ff', '#ffffff', '#000000'];
const BRUSHES = [
  { id: 'pen', label: 'Перо', icon: '✎' },
  { id: 'marker', label: 'Маркер', icon: '▰' },
  { id: 'neon', label: 'Неон', icon: 'ϟ' },
  { id: 'arrow', label: 'Стрелка', icon: '↗' },
  { id: 'blur', label: 'Размытие', icon: '◉' },
  { id: 'eraser', label: 'Ластик', icon: '⌫' },
];
const RATIOS = [
  { label: 'Произвольно', value: null },
  { label: 'Оригинал', value: 'original' },
  { label: 'Квадрат', value: 1 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '5:4', value: 5 / 4 },
  { label: '4:5', value: 4 / 5 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];
const FONTS = [
  { id: 'modern', label: 'Modern', family: 'Geologica, Inter, sans-serif' },
  { id: 'classic', label: 'Классика', family: 'Arial, sans-serif' },
  { id: 'serif', label: 'Serif', family: 'Georgia, serif' },
  { id: 'mono', label: 'Mono', family: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
];

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

export function PhotoEditorModal({ file, onCancel, onSave }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const pointerRef = useRef(null);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const stateRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  const inlineTextRef = useRef(null);

  const [tool, setTool] = useState('draw');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(1);
  const [flipY, setFlipY] = useState(1);
  const [crop, setCrop] = useState(DEFAULT_CROP);
  const [cropRatio, setCropRatio] = useState(null);
  const [objects, setObjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [brushType, setBrushType] = useState('pen');
  const [brushColor, setBrushColor] = useState('#ff4b3e');
  const [brushSize, setBrushSize] = useState(8);
  const [textDraft, setTextDraft] = useState('');
  const [textFont, setTextFont] = useState('modern');
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [editingTextId, setEditingTextId] = useState(null);
  const [canvasDisplayWidth, setCanvasDisplayWidth] = useState(1000);

  const { t } = useTranslation();

  const currentState = useMemo(() => ({ filters, rotation, flipX, flipY, crop, cropRatio, objects }), [crop, cropRatio, filters, flipX, flipY, objects, rotation]);
  stateRef.current = currentState;

  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const updateSize = () => setCanvasDisplayWidth(canvas.getBoundingClientRect().width || 1000);
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    window.addEventListener('resize', updateSize);
    return () => { observer.disconnect(); window.removeEventListener('resize', updateSize); };
  }, [isReady]);

  useEffect(() => {
    if (!editingTextId || tool !== 'text') return;
    window.requestAnimationFrame(() => {
      const input = inlineTextRef.current;
      if (!input) return;
      input.focus();
      const caret = input.value.length;
      input.setSelectionRange(caret, caret);
    });
  }, [editingTextId, tool]);

  const selectedObject = objects.find((item) => item.id === selectedId) || null;
  const filterString = useMemo(() => (
    `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%) sepia(${filters.sepia}%) blur(${filters.blur}px)`
  ), [filters]);

  const applySnapshot = useCallback((snapshot) => {
    setFilters(snapshot.filters);
    setRotation(snapshot.rotation);
    setFlipX(snapshot.flipX);
    setFlipY(snapshot.flipY);
    setCrop(snapshot.crop);
    setCropRatio(snapshot.cropRatio);
    setObjects(snapshot.objects);
    setSelectedId(null);
  }, []);

  const pushHistory = useCallback((snapshot = stateRef.current) => {
    if (!snapshot) return;
    const next = historyRef.current.slice(0, historyIndexRef.current + 1);
    next.push(cloneState(snapshot));
    if (next.length > 50) next.shift();
    historyRef.current = next;
    historyIndexRef.current = next.length - 1;
    setHistoryVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    const reader = new FileReader();
    setIsReady(false);

    reader.onload = () => {
      if (cancelled || typeof reader.result !== 'string') return;
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        imageRef.current = image;
        setIsReady(true);
      };
      image.onerror = () => {
        if (!cancelled) onCancelRef.current?.();
      };
      image.src = reader.result;
    };
    reader.onerror = () => {
      if (!cancelled) onCancelRef.current?.();
    };
    reader.readAsDataURL(file);

    return () => {
      cancelled = true;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [file]);

  useEffect(() => {
    if (!isReady) return;
    const initial = {
      filters: DEFAULT_FILTERS,
      rotation: 0,
      flipX: 1,
      flipY: 1,
      crop: DEFAULT_CROP,
      cropRatio: null,
      objects: [],
    };
    historyRef.current = [cloneState(initial)];
    historyIndexRef.current = 0;
    setHistoryVersion((value) => value + 1);
  }, [isReady]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !isReady) return;

    const rotated = Math.abs(rotation % 180) === 90;
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const targetWidth = rotated ? sourceHeight : sourceWidth;
    const targetHeight = rotated ? sourceWidth : sourceHeight;
    const scale = Math.min(1, 1800 / Math.max(targetWidth, targetHeight));
    canvas.width = Math.max(1, Math.round(targetWidth * scale));
    canvas.height = Math.max(1, Math.round(targetHeight * scale));

    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.filter = filterString;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.scale(flipX, flipY);
    context.drawImage(image, -sourceWidth * scale / 2, -sourceHeight * scale / 2, sourceWidth * scale, sourceHeight * scale);
    context.restore();

    objects.forEach((object) => {
      const isEditingSelectedText = object.type === 'text' && object.id === editingTextId && tool === 'text';
      if (!isEditingSelectedText) drawObject(context, object, canvas.width, canvas.height);
    });
    if (selectedObject && tool === 'text' && editingTextId !== selectedObject.id) {
      drawSelection(context, selectedObject, canvas.width, canvas.height);
    }
  }, [editingTextId, filterString, flipX, flipY, isReady, objects, rotation, selectedObject, tool]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onCancelRef.current?.();
      const target = event.target;
      const isEditingField = target instanceof HTMLElement
        && (target.matches('input, textarea, [contenteditable="true"]') || target.isContentEditable);
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && tool === 'text' && !isEditingField) {
        event.preventDefault();
        deleteSelectedText();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedId, tool]);

  function commit(patch = {}) {
    const next = { ...stateRef.current, ...patch };
    pushHistory(next);
  }

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: Number(value) }));
  }

  function commitFilters() {
    commit();
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    commit({ filters: DEFAULT_FILTERS });
  }

  function rotateImage() {
    const nextRotation = rotation + 90;
    setRotation(nextRotation);
    setCrop(DEFAULT_CROP);
    commit({ rotation: nextRotation, crop: DEFAULT_CROP });
  }

  function flipImage(axis) {
    if (axis === 'x') {
      const next = flipX * -1;
      setFlipX(next);
      commit({ flipX: next });
    } else {
      const next = flipY * -1;
      setFlipY(next);
      commit({ flipY: next });
    }
  }

  function selectRatio(value) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let resolved = value;
    if (value === 'original') resolved = canvas.width / canvas.height;
    let nextCrop = DEFAULT_CROP;
    if (typeof resolved === 'number') {
      const imageRatio = canvas.width / canvas.height;
      if (imageRatio > resolved) {
        const width = resolved / imageRatio;
        nextCrop = { x: (1 - width) / 2, y: 0, width, height: 1 };
      } else {
        const height = imageRatio / resolved;
        nextCrop = { x: 0, y: (1 - height) / 2, width: 1, height };
      }
    }
    setCropRatio(value);
    setCrop(nextCrop);
    commit({ cropRatio: value, crop: nextCrop });
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    applySnapshot(cloneState(historyRef.current[historyIndexRef.current]));
    setHistoryVersion((value) => value + 1);
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    applySnapshot(cloneState(historyRef.current[historyIndexRef.current]));
    setHistoryVersion((value) => value + 1);
  }

  function getNormalizedPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function handleCanvasPointerDown(event) {
    const point = getNormalizedPoint(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (tool === 'draw') {
      if (brushType === 'eraser') {
        pointerRef.current = { mode: 'erase', changed: false };
        eraseAtPoint(point);
        return;
      }
      pointerRef.current = {
        mode: 'draw',
        object: {
          id: createId(),
          type: 'path',
          brush: brushType,
          color: brushColor,
          size: brushSize,
          points: [point],
        },
      };
      return;
    }

    if (tool === 'text') {
      const hit = findTextAtPoint(objects, point, canvasRef.current);
      if (hit) {
        setSelectedId(hit.id);
        setEditingTextId(hit.id);
        setTextDraft(hit.text);
        pointerRef.current = { mode: 'move-text', id: hit.id, start: point, initial: { x: hit.x, y: hit.y } };
      } else {
        const object = createTextObject(point, '');
        const next = [...objects, object];
        setObjects(next);
        setSelectedId(object.id);
        setEditingTextId(object.id);
        setTextDraft(object.text);
        commit({ objects: next });
      }
    }
  }

  function handleCanvasPointerMove(event) {
    const active = pointerRef.current;
    if (!active) return;
    const point = getNormalizedPoint(event);

    if (active.mode === 'draw') {
      active.object.points.push(point);
      const preview = active.object;
      renderCanvas();
      const context = canvasRef.current.getContext('2d');
      drawObject(context, preview, canvasRef.current.width, canvasRef.current.height);
      return;
    }

    if (active.mode === 'erase') {
      eraseAtPoint(point);
      return;
    }

    if (active.mode === 'move-text') {
      const dx = point.x - active.start.x;
      const dy = point.y - active.start.y;
      setObjects((items) => items.map((item) => item.id === active.id
        ? { ...item, x: clamp(active.initial.x + dx, 0, 1), y: clamp(active.initial.y + dy, 0, 1) }
        : item));
    }
  }

  function handleCanvasPointerUp() {
    const active = pointerRef.current;
    if (!active) return;
    pointerRef.current = null;

    if (active.mode === 'draw' && active.object.points.length > 1) {
      const next = [...objects, active.object];
      setObjects(next);
      commit({ objects: next });
    } else if (active.mode === 'erase' && active.changed) {
      window.requestAnimationFrame(() => commit());
    } else if (active.mode === 'move-text') {
      window.requestAnimationFrame(() => commit());
    }
  }

  function createTextObject(point = { x: 0.5, y: 0.5 }, value = '') {
    return {
      id: createId(),
      type: 'text',
      text: value,
      x: point.x,
      y: point.y,
      size: 64,
      color: brushColor,
      font: textFont,
      rotation: 0,
    };
  }

  function eraseAtPoint(point) {
    const canvas = canvasRef.current;
    const normalizedRadius = Math.max(0.012, (brushSize * 2.8) / Math.max(320, canvas?.clientWidth || 1000));

    setObjects((items) => {
      let changed = false;
      const next = [];

      items.forEach((item) => {
        // Текст удаляется только отдельной кнопкой. Ластик работает по нарисованным линиям.
        if (item.type !== 'path') {
          next.push(item);
          return;
        }

        const fragments = splitPathByEraser(item, point, normalizedRadius);
        if (fragments.length === 1 && fragments[0] === item) {
          next.push(item);
          return;
        }

        changed = true;
        next.push(...fragments);
      });

      if (changed && pointerRef.current?.mode === 'erase') {
        pointerRef.current.changed = true;
      }
      return next;
    });
  }

  function addText() {
    const value = '';
    const object = createTextObject({ x: 0.5, y: 0.5 }, value);
    const next = [...objects, object];
    setObjects(next);
    setSelectedId(object.id);
    setEditingTextId(object.id);
    setTextDraft(value);
    commit({ objects: next });
  }

  function updateSelectedText(patch, shouldCommit = false) {
    if (!selectedId) return;
    const next = objects.map((item) => item.id === selectedId ? { ...item, ...patch } : item);
    setObjects(next);
    if (shouldCommit) commit({ objects: next });
  }

  function deleteSelectedText() {
    if (!selectedId) return;
    const next = objects.filter((item) => item.id !== selectedId);
    setObjects(next);
    setSelectedId(null);
    setEditingTextId(null);
    commit({ objects: next });
  }

  function handleCropPointerDown(event, handle) {
    event.preventDefault();
    event.stopPropagation();
    pointerRef.current = { mode: 'crop', handle, startX: event.clientX, startY: event.clientY, initial: { ...crop } };
    window.addEventListener('pointermove', handleCropPointerMove);
    window.addEventListener('pointerup', handleCropPointerUp, { once: true });
  }

  function handleCropPointerMove(event) {
    const active = pointerRef.current;
    const stage = stageRef.current;
    if (!active || active.mode !== 'crop' || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = (event.clientX - active.startX) / rect.width;
    const dy = (event.clientY - active.startY) / rect.height;
    let next = { ...active.initial };
    const min = 0.08;

    if (active.handle === 'move') {
      next.x = clamp(active.initial.x + dx, 0, 1 - active.initial.width);
      next.y = clamp(active.initial.y + dy, 0, 1 - active.initial.height);
    } else {
      if (active.handle.includes('e')) next.width = clamp(active.initial.width + dx, min, 1 - active.initial.x);
      if (active.handle.includes('s')) next.height = clamp(active.initial.height + dy, min, 1 - active.initial.y);
      if (active.handle.includes('w')) {
        next.x = clamp(active.initial.x + dx, 0, active.initial.x + active.initial.width - min);
        next.width = active.initial.width + (active.initial.x - next.x);
      }
      if (active.handle.includes('n')) {
        next.y = clamp(active.initial.y + dy, 0, active.initial.y + active.initial.height - min);
        next.height = active.initial.height + (active.initial.y - next.y);
      }
    }
    setCrop(next);
    setCropRatio(null);
  }

  function handleCropPointerUp() {
    window.removeEventListener('pointermove', handleCropPointerMove);
    pointerRef.current = null;
    window.requestAnimationFrame(() => commit({ cropRatio: null }));
  }

  async function saveImage() {
    const canvas = canvasRef.current;
    if (!canvas || isSaving) return;
    setIsSaving(true);
    try {
      const sx = Math.round(crop.x * canvas.width);
      const sy = Math.round(crop.y * canvas.height);
      const sw = Math.max(1, Math.round(crop.width * canvas.width));
      const sh = Math.max(1, Math.round(crop.height * canvas.height));
      const output = document.createElement('canvas');
      output.width = sw;
      output.height = sh;
      output.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise((resolve, reject) => {
        output.toBlob((result) => result ? resolve(result) : reject(new Error('Не удалось подготовить изображение')), 'image/jpeg', 0.94);
      });
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
      onSave(new File([blob], `${baseName}-edited.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
    } finally {
      setIsSaving(false);
    }
  }

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1;

  return (
    <div className="photo-editor-backdrop" role="presentation">
      <section aria-label={t('photoEditor', 'Редактор фотографии')} aria-modal="true" className="photo-editor-modal" role="dialog">
        <div className="photo-editor-stage-shell">
          <div className="photo-editor-history-float">
            <button aria-label="Отменить" disabled={!canUndo} onClick={undo} type="button">↶</button>
            <button aria-label="Повторить" disabled={!canRedo} onClick={redo} type="button">↷</button>
          </div>
          <div className="photo-editor-stage" ref={stageRef}>
            {!isReady ? <div className="photo-editor-loader">Загрузка…</div> : null}
            <canvas
              className={`photo-editor-canvas is-${tool}`}
              onPointerCancel={handleCanvasPointerUp}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              ref={canvasRef}
            />
            {tool === 'text' && selectedObject?.type === 'text' && editingTextId === selectedObject.id ? (
              <div
                className="photo-editor-inline-text-wrap"
                onPointerDown={(event) => event.stopPropagation()}
                style={{
                  left: `${selectedObject.x * 100}%`,
                  top: `${selectedObject.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${selectedObject.rotation || 0}deg)`,
                  '--inline-font-size': `${Math.max(18, selectedObject.size * (canvasDisplayWidth / 1000))}px`,
                  '--inline-font-family': (FONTS.find((item) => item.id === selectedObject.font) || FONTS[0]).family,
                  '--inline-text-color': selectedObject.color,
                }}
              >
                <textarea
                  aria-label="Текст на изображении"
                  onBlur={() => {
                    commit();
                    setEditingTextId(null);
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTextDraft(value);
                    updateSelectedText({ text: value });
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') event.currentTarget.blur();
                  }}
                  ref={inlineTextRef}
                  placeholder={t('editorTextPlaceholder', 'Введите текст')}
                  rows={1}
                  value={selectedObject.text}
                />
                <button aria-label="Удалить текст" className="photo-editor-inline-delete" onClick={deleteSelectedText} onPointerDown={(event) => event.preventDefault()} type="button">×</button>
              </div>
            ) : null}
            {tool === 'transform' && isReady ? (
              <div
                className="photo-editor-crop-box"
                onPointerDown={(event) => handleCropPointerDown(event, 'move')}
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
              >
                {['nw', 'ne', 'sw', 'se'].map((handle) => (
                  <span className={`crop-handle crop-${handle}`} key={handle} onPointerDown={(event) => handleCropPointerDown(event, handle)} />
                ))}
                <span className="crop-grid crop-grid-v1" /><span className="crop-grid crop-grid-v2" />
                <span className="crop-grid crop-grid-h1" /><span className="crop-grid crop-grid-h2" />
              </div>
            ) : null}
          </div>
        </div>

        <aside className="photo-editor-panel">
          <div className="photo-editor-panel-content">
            {tool === 'draw' ? (
              <>
                <PanelTitle>Цвет</PanelTitle>
                <ColorPicker color={brushColor} onChange={setBrushColor} />
                <PanelTitle>Тип кисти</PanelTitle>
                <div className="photo-editor-brushes">
                  {BRUSHES.map((brush) => (
                    <button className={brushType === brush.id ? 'is-active' : ''} key={brush.id} onClick={() => setBrushType(brush.id)} title={brush.label} type="button">{brush.icon}</button>
                  ))}
                </div>
                <EditorRange label="Размер кисти" max={80} min={1} onAfterChange={() => {}} onChange={setBrushSize} suffix="" value={brushSize} />
              </>
            ) : null}

            {tool === 'text' ? (
              <>
                <div className="photo-editor-text-actions">
                  <p>Нажмите на изображение и вводите текст прямо поверх него.</p>
                  <button onClick={addText} type="button">＋ Добавить по центру</button>
                  <button className="is-danger" disabled={!selectedObject} onClick={deleteSelectedText} type="button">⌫</button>
                </div>
                <PanelTitle>Цвет</PanelTitle>
                <ColorPicker color={selectedObject?.color || brushColor} onChange={(value) => {
                  setBrushColor(value);
                  if (selectedObject) updateSelectedText({ color: value }, true);
                }} />
                <PanelTitle>Шрифт</PanelTitle>
                <div className="photo-editor-fonts">
                  {FONTS.map((font) => (
                    <button className={(selectedObject?.font || textFont) === font.id ? 'is-active' : ''} key={font.id} onClick={() => {
                      setTextFont(font.id);
                      if (selectedObject) updateSelectedText({ font: font.id }, true);
                    }} style={{ fontFamily: font.family }} type="button">{font.label}</button>
                  ))}
                </div>
                <EditorRange label="Размер текста" max={180} min={20} onChange={(value) => selectedObject && updateSelectedText({ size: value })} onAfterChange={() => selectedObject && commit()} suffix="" value={selectedObject?.size || 64} />
                <EditorRange label="Поворот текста" max={180} min={-180} onChange={(value) => selectedObject && updateSelectedText({ rotation: value })} onAfterChange={() => selectedObject && commit()} suffix="°" value={selectedObject?.rotation || 0} />
              </>
            ) : null}

            {tool === 'transform' ? (
              <>
                <PanelTitle>Трансформация</PanelTitle>
                <div className="photo-editor-action-row">
                  <button onClick={rotateImage} title="Повернуть" type="button">↻</button>
                  <button onClick={() => flipImage('x')} title="Отразить по горизонтали" type="button">↔</button>
                  <button onClick={() => flipImage('y')} title="Отразить по вертикали" type="button">↕</button>
                </div>
                <PanelTitle>Пропорции</PanelTitle>
                <div className="photo-editor-ratios">
                  {RATIOS.map((item) => (
                    <button className={cropRatio === item.value ? 'is-active' : ''} key={item.label} onClick={() => selectRatio(item.value)} type="button">{item.label}</button>
                  ))}
                </div>
              </>
            ) : null}

            {tool === 'adjust' ? (
              <>
                <div className="photo-editor-filter-head"><PanelTitle>Фильтры</PanelTitle><button onClick={resetFilters} type="button">Сбросить</button></div>
                <EditorRange label="Яркость" max={200} min={0} onAfterChange={commitFilters} onChange={(value) => updateFilter('brightness', value)} value={filters.brightness} />
                <EditorRange label="Контраст" max={200} min={0} onAfterChange={commitFilters} onChange={(value) => updateFilter('contrast', value)} value={filters.contrast} />
                <EditorRange label="Насыщенность" max={200} min={0} onAfterChange={commitFilters} onChange={(value) => updateFilter('saturate', value)} value={filters.saturate} />
                <EditorRange label="Сепия" max={100} min={0} onAfterChange={commitFilters} onChange={(value) => updateFilter('sepia', value)} value={filters.sepia} />
                <EditorRange label="Размытие" max={20} min={0} onAfterChange={commitFilters} onChange={(value) => updateFilter('blur', value)} suffix="px" value={filters.blur} />
              </>
            ) : null}
          </div>

          <nav className="photo-editor-toolbar">
            <button aria-label="Закрыть" className="is-cancel" onClick={onCancel} title="Закрыть" type="button">×</button>
            <button aria-label="Кисть" className={tool === 'draw' ? 'is-active' : ''} onClick={() => setTool('draw')} title="Кисть" type="button">✎</button>
            <button aria-label="Текст" className={tool === 'text' ? 'is-active' : ''} onClick={() => setTool('text')} title="Текст" type="button">T</button>
            <button aria-label="Размер и обрезка" className={tool === 'transform' ? 'is-active' : ''} onClick={() => setTool('transform')} title="Размер и обрезка" type="button">⌗</button>
            <button aria-label="Фильтры" className={tool === 'adjust' ? 'is-active' : ''} onClick={() => setTool('adjust')} title="Фильтры" type="button">✣</button>
            <button aria-label="Сохранить" className="is-save" disabled={!isReady || isSaving} onClick={saveImage} title="Сохранить" type="button">✓</button>
          </nav>
        </aside>
      </section>
    </div>
  );
}

function PanelTitle({ children }) {
  return <h3 className="photo-editor-panel-title">{children}</h3>;
}

function ColorPicker({ color, onChange }) {
  return (
    <div className="photo-editor-colors">
      {COLORS.map((item) => <button aria-label={item} className={color === item ? 'is-active' : ''} key={item} onClick={() => onChange(item)} style={{ background: item }} type="button" />)}
      <label className="photo-editor-custom-color" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
        <input onChange={(event) => onChange(event.target.value)} type="color" value={color} />
      </label>
    </div>
  );
}

function EditorRange({ label, min, max, value, onChange, onAfterChange, suffix = '%' }) {
  return (
    <label className="photo-editor-range">
      <span>{label}</span><strong>{value}{suffix}</strong>
      <input max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} onPointerUp={onAfterChange} onTouchEnd={onAfterChange} type="range" value={value} />
    </label>
  );
}

function drawObject(context, object, width, height) {
  if (object.type === 'text') {
    const font = FONTS.find((item) => item.id === object.font) || FONTS[0];
    const size = object.size * (width / 1000);
    context.save();
    context.translate(object.x * width, object.y * height);
    context.rotate((object.rotation || 0) * Math.PI / 180);
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
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
  context.stroke();

  if (object.brush === 'arrow') {
    const end = points[points.length - 1];
    const previous = points[Math.max(0, points.length - 3)];
    const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
    const head = Math.max(14, context.lineWidth * 3);
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.stroke();
  }
  context.restore();
}

function drawSelection(context, object, width, height) {
  if (object.type !== 'text') return;
  const font = FONTS.find((item) => item.id === object.font) || FONTS[0];
  const size = object.size * (width / 1000);
  context.save();
  context.font = `700 ${size}px ${font.family}`;
  const metrics = context.measureText(object.text);
  const boxWidth = metrics.width + 28;
  const boxHeight = size * 1.45;
  context.translate(object.x * width, object.y * height);
  context.rotate((object.rotation || 0) * Math.PI / 180);
  context.strokeStyle = 'rgba(255,255,255,.9)';
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.strokeRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
  context.restore();
}

function findTextAtPoint(objects, point, canvas) {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (object.type !== 'text') continue;
    const width = Math.max(0.08, object.text.length * object.size / 12000);
    const height = Math.max(0.05, object.size / 1200);
    if (Math.abs(point.x - object.x) <= width && Math.abs(point.y - object.y) <= height) return object;
  }
  return null;
}

function splitPathByEraser(path, point, radius) {
  if (path.type !== 'path' || path.points.length < 2) return [path];

  const keptRuns = [];
  let currentRun = [];
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
    id: index === 0 ? path.id : createId(),
    points,
    // После разрезания стрелки фрагменты становятся обычными линиями,
    // чтобы наконечник не появлялся на каждом кусочке.
    brush: path.brush === 'arrow' ? 'pen' : path.brush,
  }));
}

function objectTouchesPoint(object, point, radius, canvas) {
  if (object.type === 'text') return Boolean(findTextAtPoint([object], point, canvas));
  if (object.type !== 'path') return false;
  return object.points.some((item) => Math.hypot(item.x - point.x, item.y - point.y) <= radius);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
