import { useEffect } from 'react';
import { Avatar, Icon } from '@/shared/ui';
import { CALLS_ENABLED } from '@/shared/config';
import { useCall } from '../model/useCall';

/**
 * Оверлей входящего и исходящего вызова поверх приложения (#773).
 *
 * Экран активного разговора реализуется в #774.
 */
export function CallOverlay({ enabled = CALLS_ENABLED }: { enabled?: boolean }) {
  const { incomingCall, outgoingCall, activeCall, acceptCall, rejectCall, cancelCall, endCall } =
    useCall();

  useEffect(() => {
    if (enabled) return;
    if (incomingCall) rejectCall();
    else if (outgoingCall) cancelCall();
    else if (activeCall) endCall('completed');
  }, [enabled, incomingCall, outgoingCall, activeCall, rejectCall, cancelCall, endCall]);

  if (!enabled) return null;

  if (incomingCall) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-ground/80 backdrop-blur-md p-4 animate-fade-in">
        <div className="bg-sheet rounded-window shadow-[var(--elev-2)] p-6 w-full max-w-sm text-center flex flex-col items-center border border-line-soft">
          <Avatar
            className="mb-4"
            id={incomingCall.from}
            name={incomingCall.fromName}
            size="2xl"
            src={incomingCall.fromAvatar}
          />
          <h2 className="text-lg font-bold text-ink mb-1 truncate max-w-full">
            {incomingCall.fromName || 'Неизвестный'}
          </h2>
          <p className="text-sm text-ink-2 mb-6">
            {incomingCall.kind === 'video' ? 'Видеозвонок…' : 'Аудиозвонок…'}
          </p>
          <div className="flex items-center justify-center gap-8">
            <button
              type="button"
              className="flex flex-col items-center gap-2 group cursor-pointer focus-visible:outline-none"
              onClick={rejectCall}
              aria-label="Отклонить"
            >
              <div className="size-14 rounded-full bg-danger text-white flex items-center justify-center shadow-[var(--elev-2)] transition-transform group-hover:scale-105 active:scale-95">
                <Icon name="phone" className="size-6 rotate-[135deg]" />
              </div>
              <span className="text-xs text-ink-2 font-medium">Отклонить</span>
            </button>
            <button
              type="button"
              className="flex flex-col items-center gap-2 group cursor-pointer focus-visible:outline-none"
              onClick={acceptCall}
              aria-label="Принять"
            >
              <div className="size-14 rounded-full bg-ok text-white flex items-center justify-center shadow-[var(--elev-2)] transition-transform group-hover:scale-105 active:scale-95">
                <Icon name={incomingCall.kind === 'video' ? 'video' : 'phone'} className="size-6" />
              </div>
              <span className="text-xs text-ink-2 font-medium">Принять</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (outgoingCall) {
    const getOutgoingSubtitle = () => {
      switch (outgoingCall.phase) {
        case 'calling':
          return 'Вызов…';
        case 'ringing':
          return 'Звонит…';
        case 'declined':
          return 'Отклонён';
        case 'busy':
          return 'Занят';
        case 'no_answer':
          return 'Не отвечает';
        case 'cancelled':
          return 'Вызов отменён';
        default:
          return 'Вызов…';
      }
    };

    const isEnding = ['declined', 'busy', 'no_answer', 'cancelled'].includes(outgoingCall.phase);

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-ground/80 backdrop-blur-md p-4 animate-fade-in">
        <div className="bg-sheet rounded-window shadow-[var(--elev-2)] p-6 w-full max-w-sm text-center flex flex-col items-center border border-line-soft">
          <Avatar
            className="mb-4"
            id={outgoingCall.peerId}
            name={outgoingCall.peerName ?? undefined}
            size="2xl"
            src={outgoingCall.peerAvatar}
          />
          <h2 className="text-lg font-bold text-ink mb-1 truncate max-w-full">
            {outgoingCall.peerName || outgoingCall.title || 'Пользователь'}
          </h2>
          <p className="text-sm text-ink-2 mb-6">{getOutgoingSubtitle()}</p>
          <div className="flex items-center justify-center">
            <button
              type="button"
              className="flex flex-col items-center gap-2 group cursor-pointer focus-visible:outline-none"
              onClick={cancelCall}
              disabled={isEnding}
              aria-label="Отменить"
            >
              <div className="size-14 rounded-full bg-danger text-white flex items-center justify-center shadow-[var(--elev-2)] transition-transform group-hover:scale-105 active:scale-95 disabled:opacity-50">
                <Icon name="phone" className="size-6 rotate-[135deg]" />
              </div>
              <span className="text-xs text-ink-2 font-medium">Отменить</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
