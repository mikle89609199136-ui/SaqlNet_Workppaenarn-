import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { Spinner } from '../Spinner';
import { clampPosition, cropAvatar, type CropPosition } from './cropAvatar';

interface Props {
  file: File;
  onCancel: () => void;
  onComplete: (file: File) => void;
}

export function AvatarCropModal({ file, onCancel, onComplete }: Props) {
  const { t } = useTranslation();
  const imageRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState<CropPosition>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const hintId = useId();

  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (imageRef.current) imageRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const minSide = Math.min(size.width, size.height) || 1;
  const width = (size.width / minSide) * zoom;
  const height = (size.height / minSide) * zoom;
  const ready = size.width > 0 && !error;

  function move(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId || saving) return;
    const previous = drag.current;
    const viewport = event.currentTarget.getBoundingClientRect().width;
    if (viewport <= 0) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setPosition((value) => ({
      x: width > 1 ? clampPosition(value.x + (2 * dx) / (viewport * (width - 1))) : 0,
      y: height > 1 ? clampPosition(value.y + (2 * dy) / (viewport * (height - 1))) : 0,
    }));
  }

  async function confirm() {
    if (!ready || !imageRef.current || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await cropAvatar(imageRef.current, file.name, zoom, position);
      onComplete(result);
    } catch {
      setError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal
      closable={!saving}
      onClose={() => {
        if (!savingRef.current) onCancel();
      }}
      title={t('avatarCrop.title', 'Обрезка фото')}
      footer={
        <>
          <Button disabled={saving} onClick={onCancel} type="button" variant="ghost">
            {t('cancel', 'Отмена')}
          </Button>
          <Button disabled={!ready} loading={saving} onClick={confirm} type="button">
            {t('avatarCrop.done', 'Готово')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p id={hintId}>
          {t(
            'avatarCrop.hint',
            'Перемещайте фото и меняйте масштаб. Для точной настройки используйте стрелки на клавиатуре.'
          )}
        </p>
        <div
          aria-describedby={hintId}
          aria-label={t('avatarCrop.position', 'Положение фото')}
          className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-control bg-black outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
          onKeyDown={(event) => {
            const direction = {
              ArrowLeft: [-0.05, 0],
              ArrowRight: [0.05, 0],
              ArrowUp: [0, -0.05],
              ArrowDown: [0, 0.05],
            }[event.key];
            if (!direction || saving || !ready) return;
            event.preventDefault();
            setPosition((value) => ({
              x: clampPosition(value.x + direction[0]),
              y: clampPosition(value.y + direction[1]),
            }));
          }}
          onPointerDown={(event) => {
            if (!ready || saving || !event.isPrimary || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerMove={move}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          role="group"
          style={{ cursor: ready ? 'grab' : undefined }}
          tabIndex={0}
        >
          <img
            alt=""
            className="pointer-events-none absolute max-w-none"
            draggable={false}
            onError={() => setError(true)}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            ref={imageRef}
            style={{
              width: `${width * 100}%`,
              height: `${height * 100}%`,
              left: `${(((1 - width) * (1 - position.x)) / 2) * 100}%`,
              top: `${(((1 - height) * (1 - position.y)) / 2) * 100}%`,
            }}
          />
          <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white shadow-[0_0_0_100vmax_#0009]" />
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner />
            </div>
          )}
        </div>
        <label className="flex flex-col gap-2">
          {t('avatarCrop.zoom', 'Масштаб')}
          <input
            disabled={!ready || saving}
            max="4"
            min="1"
            onChange={(event) => setZoom(Number(event.target.value))}
            step="0.01"
            type="range"
            value={zoom}
          />
        </label>
        {file.type === 'image/gif' && (
          <p>{t('avatarCrop.gifHint', 'Аватарка будет сохранена без анимации.')}</p>
        )}
        {error && (
          <p className="text-danger" role="alert">
            {t(
              'avatarCrop.error',
              'Не удалось обработать фото. Попробуйте выбрать другое изображение.'
            )}
          </p>
        )}
      </div>
    </Modal>
  );
}
