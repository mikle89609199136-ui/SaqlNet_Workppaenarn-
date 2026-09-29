import { useEffect } from 'react';
import { Avatar } from '@/shared/ui';
import { CALLS_ENABLED } from '@/shared/config';
import { useCall } from '../model/useCall';

/**
 * Входящий вызов поверх приложения.
 *
 * Сам разговор рисовал старый `call.html` в iframe — он удалён (#776):
 * держал второй сокет и токен из localStorage. Новый экран разговора — #774.
 * Пока его нет, звонки выключены (`CALLS_ENABLED`): вызов, пришедший от
 * ещё не обновлённого клиента, отклоняется сразу — иначе звонящий минуту
 * слушал бы гудки, на которые здесь нечем ответить.
 */
export function CallOverlay({ enabled = CALLS_ENABLED }: { enabled?: boolean }) {
  const { incomingCall, activeCall, acceptCall, rejectCall, endCall } = useCall();

  useEffect(() => {
    if (enabled) return;
    if (incomingCall) rejectCall();
    else if (activeCall) endCall('completed');
  }, [enabled, incomingCall, activeCall, rejectCall, endCall]);

  if (!enabled || !incomingCall) return null;

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-card">
        <Avatar
          className="mx-auto mb-5"
          id={incomingCall.from}
          name={incomingCall.fromName}
          size="2xl"
          src={incomingCall.fromAvatar}
        />
        <h2>{incomingCall.fromName || 'Неизвестный'}</h2>
        <p>{incomingCall.kind === 'audio' ? 'Аудиозвонок...' : 'Видеозвонок...'}</p>
        <div className="incoming-call-actions">
          <button className="call-btn accept" onClick={acceptCall} aria-label="Принять">
            📞
          </button>
          <button className="call-btn reject" onClick={rejectCall} aria-label="Отклонить">
            🚫
          </button>
        </div>
      </div>
    </div>
  );
}
