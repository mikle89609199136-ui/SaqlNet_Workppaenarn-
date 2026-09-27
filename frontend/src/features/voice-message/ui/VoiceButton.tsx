import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib';
import { Button, Icon } from '@/shared/ui';
import type { IVoiceRecorderState, IVoiceRecording, VoiceRecorder } from '../model/voiceRecorder';

interface Props {
  recorder: VoiceRecorder;
  state: IVoiceRecorderState;
  onRecorded: (recording: IVoiceRecording) => void;
  /** Насколько смахнули влево, 0…1 — для подсказки в полосе записи. */
  onCancelProgress?: (progress: number) => void;
  disabled?: boolean;
}

/** Короче — это щелчок: запись сразу закрепляется, держать не нужно. */
const TAP_MS = 250;
/** Смахнуть влево на столько — отмена; вверх — закрепить. */
const CANCEL_DISTANCE = 96;
const LOCK_DISTANCE = 64;

/**
 * Кнопка голосового по макету (#843), в месте кнопки «Отправить».
 *
 * - Удержание — запись; смахнуть влево — отмена; вверх — закрепить и
 *   отпустить палец. Отпустили удерживаемую — отправлено.
 * - Щелчок мышью, Enter или пробел — сразу закреплённая запись.
 * - Закреплённая: кнопка становится «Отправить». Esc — отмена.
 * - `pointercancel` (браузер забрал жест под прокрутку) — отмена: иначе
 *   запись осталась бы висеть без пальца на кнопке.
 */
export function VoiceButton({ recorder, state, onRecorded, onCancelProgress, disabled }: Props) {
  const { t } = useTranslation();
  const gesture = useRef<{ x: number; y: number; at: number; pointerId: number } | null>(null);
  const { status } = state;
  const active = status !== 'idle';

  async function send() {
    const recording = await recorder.finish();
    if (recording) onRecorded(recording);
  }

  // Esc отменяет запись, где бы ни был фокус.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        recorder.cancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, recorder]);

  function endGesture() {
    gesture.current = null;
    onCancelProgress?.(0);
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0 || status !== 'idle') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
      pointerId: event.pointerId,
    };
    void recorder.start();
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (!start || event.pointerId !== start.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (dx <= -CANCEL_DISTANCE) {
      endGesture();
      recorder.cancel();
      return;
    }
    if (dy <= -LOCK_DISTANCE) {
      endGesture();
      recorder.lock();
      return;
    }
    onCancelProgress?.(Math.min(1, Math.max(0, -dx / CANCEL_DISTANCE)));
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (!start || event.pointerId !== start.pointerId) return;
    endGesture();

    // Щелчок, а не удержание: запись остаётся, закреплённой.
    if (Date.now() - start.at < TAP_MS) {
      recorder.lock();
      return;
    }
    if (recorder.getState().status === 'locked') return;
    void send();
  }

  function onPointerCancel() {
    if (!gesture.current) return;
    endGesture();
    recorder.cancel();
  }

  // Клавиатура: щелчок без указателя (detail === 0).
  function onClick(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail !== 0 || disabled) return;
    if (status === 'idle') void recorder.start(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      recorder.cancel();
    }
  }

  if (status === 'locked' || status === 'stopping') {
    return (
      <Button
        aria-label={t('voice.send', 'Отправить голосовое')}
        disabled={status === 'stopping'}
        iconOnly
        onClick={() => void send()}
        type="button"
        variant="primary"
      >
        <Icon className="size-4.75 stroke-2" name="send" />
      </Button>
    );
  }

  const holding = status === 'recording' || status === 'requesting';
  return (
    <span className="relative flex shrink-0">
      {/* Подсказка «вверх — закрепить», пока держат кнопку. */}
      {holding && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col items-center gap-1 rounded-pill bg-sheet-2 px-2 py-2 text-ink-2 shadow-[var(--shadow-menu)]"
        >
          <Icon className="size-4 stroke-2" name="lock" />
          <Icon className="size-3.5 -rotate-90 stroke-2" name="chevronRight" />
        </span>
      )}
      <Button
        aria-label={t('voice.record', 'Записать голосовое')}
        aria-pressed={holding}
        className={cn('touch-none select-none', holding ? 'bg-rec text-white' : 'text-ink-2')}
        disabled={disabled}
        iconOnly
        onClick={onClick}
        onContextMenu={(event) => event.preventDefault()}
        // Кодировщик и шумодав грузятся, пока курсор или фокус на кнопке:
        // запись начнётся без паузы на загрузку.
        onFocus={() => recorder.preload()}
        onKeyDown={onKeyDown}
        onPointerEnter={() => recorder.preload()}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={t('voice.hint', 'Удерживайте, чтобы записать, или нажмите')}
        type="button"
        variant="ghost"
      >
        <Icon className="size-5 stroke-2" name="mic" />
      </Button>
    </span>
  );
}
