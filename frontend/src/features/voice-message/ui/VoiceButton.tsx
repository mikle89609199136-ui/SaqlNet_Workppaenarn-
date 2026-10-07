import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib';
import { Button, Icon } from '@/shared/ui';
import type { IVoiceRecorderState, IVoiceRecording, VoiceRecorder } from '../model/voiceRecorder';
import { VoiceLockHint } from './VoiceLockHint';
import { VoiceRecordCircle } from './VoiceRecordCircle';

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
 * - Касанием — как в Telegram: большой круг с кольцом по громкости и замок
 *   над ним; закрепили — круг становится «Отправить», замок закрыт. Мышью
 *   этого нет: щелчок и так закрепляет запись, подсказка «вверх» лишняя.
 * - `pointercancel` (браузер забрал жест под прокрутку) — отмена: иначе
 *   запись осталась бы висеть без пальца на кнопке.
 */
export function VoiceButton({ recorder, state, onRecorded, onCancelProgress, disabled }: Props) {
  const { t } = useTranslation();
  const gesture = useRef<{ x: number; y: number; at: number; pointerId: number } | null>(null);
  const { status } = state;
  const active = status !== 'idle';
  // Запись начали касанием (палец, стилус), а не мышью или клавиатурой.
  const [touch, setTouch] = useState(false);
  const [lockProgress, setLockProgress] = useState(0);
  const [dragX, setDragX] = useState(0);
  const level = state.levels[state.levels.length - 1] ?? 0;

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
    setLockProgress(0);
    setDragX(0);
    onCancelProgress?.(0);
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0 || status !== 'idle') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setTouch(event.pointerType !== 'mouse');
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
    setLockProgress(Math.min(1, Math.max(0, -dy / LOCK_DISTANCE)));
    setDragX(Math.min(0, dx));
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
    if (status !== 'idle') return;
    setTouch(false);
    void recorder.start(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      recorder.cancel();
    }
  }

  if (status === 'locked' || status === 'stopping') {
    if (touch) {
      return (
        <span className="relative flex size-10 shrink-0">
          <VoiceLockHint locked />
          <VoiceRecordCircle
            level={level}
            locked
            onSend={() => void send()}
            sending={status === 'stopping'}
          />
        </span>
      );
    }
    return (
      <span className="relative flex shrink-0">
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
      </span>
    );
  }

  const holding = status === 'recording' || status === 'requesting';
  return (
    <span className="relative flex shrink-0">
      {/* «Вверх — закрепить», пока палец держит кнопку. */}
      {holding && touch && (
        <>
          <VoiceLockHint progress={lockProgress} />
          <VoiceRecordCircle level={level} offsetX={dragX} />
        </>
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
