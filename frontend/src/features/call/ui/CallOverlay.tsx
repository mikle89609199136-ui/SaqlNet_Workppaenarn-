import { Avatar } from '@/shared/ui';
import { config } from '@/shared/config';
import { useCall } from '../model/useCall';
import { useCallStore } from '../model/callStore';
import { useEffect, useRef } from 'react';

export function CallOverlay() {
  const { incomingCall, activeCall, isMinimized, acceptCall, rejectCall, endCall, maximizeCall } =
    useCall();

  const frameRef = useRef<HTMLIFrameElement | null>(null);

  /* Кадр перецепляется при смене комнаты, поэтому и проверка идёт по
     ней: раньше эффект смотрел на весь `activeCall`, а в зависимостях
     держал только `roomId` — то есть заявлял одно, а читал другое. */
  const activeRoomId = activeCall?.roomId;

  useEffect(() => {
    if (!activeRoomId) return undefined;
    useCallStore.getState().attachCallFrame(frameRef.current);
    return () => useCallStore.getState().attachCallFrame(null);
  }, [activeRoomId]);

  if (incomingCall) {
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

  if (activeCall) {
    const apiOrigin = new URL(config.apiBaseUrl, window.location.href).origin;
    const url = new URL('/call.html', apiOrigin);
    url.searchParams.set('room', activeCall.roomId);
    url.searchParams.set('type', activeCall.type);
    url.searchParams.set('kind', activeCall.kind);
    url.searchParams.set('title', activeCall.title || '');
    url.searchParams.set('chatId', activeCall.chatId || '');
    url.searchParams.set('apiBase', config.apiBaseUrl);
    url.searchParams.set('socketUrl', config.socketUrl);
    url.searchParams.set('embedded', '1');

    return (
      <>
        {isMinimized ? (
          <div className="minimized-call-bar" onClick={maximizeCall}>
            <div className="minimized-call-info">
              <span className="call-pulse-dot"></span>
              <span>Идёт звонок: {activeCall.title}</span>
            </div>
            <div className="minimized-call-actions" onClick={(e) => e.stopPropagation()}>
              <button className="minimized-return-btn" onClick={maximizeCall}>
                Вернуться
              </button>
              <button className="minimized-end-btn" onClick={() => endCall('completed')}>
                ×
              </button>
            </div>
          </div>
        ) : null}
        <div className={`fullscreen-call-overlay ${isMinimized ? 'is-minimized' : ''}`}>
          <iframe
            ref={frameRef}
            src={url.toString()}
            title="WebRTC Call"
            allow="camera; microphone; display-capture"
          />
        </div>
      </>
    );
  }

  return null;
}
