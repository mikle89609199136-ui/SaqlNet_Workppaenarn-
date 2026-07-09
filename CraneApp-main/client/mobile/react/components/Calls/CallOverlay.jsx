import { useCall } from './CallProvider.jsx';

export function CallOverlay() {
  const {
    incomingCall,
    activeCall,
    isMinimized,
    acceptCall,
    rejectCall,
    endCall,
    maximizeCall
  } = useCall();

  if (incomingCall) {
    const avatarChar = (incomingCall.fromName || '?').charAt(0).toUpperCase();
    return (
      <div className="incoming-call-overlay">
        <div className="incoming-call-card">
          <div className="incoming-call-avatar">
            {incomingCall.fromAvatar ? (
              <img src={incomingCall.fromAvatar} alt="" />
            ) : (
              <span>{avatarChar}</span>
            )}
          </div>
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
    const url = `/call.html?room=${encodeURIComponent(activeCall.roomId)}` +
      `&type=${encodeURIComponent(activeCall.type)}` +
      `&kind=${encodeURIComponent(activeCall.kind)}` +
      `&title=${encodeURIComponent(activeCall.title)}` +
      '&embedded=1';

    if (isMinimized) {
      return (
        <div className="minimized-call-bar" onClick={maximizeCall}>
          <div className="minimized-call-info">
            <span className="call-pulse-dot"></span>
            <span>Идёт звонок: {activeCall.title}</span>
          </div>
          <div className="minimized-call-actions" onClick={(e) => e.stopPropagation()}>
            <button className="minimized-return-btn" onClick={maximizeCall}>Вернуться</button>
            <button className="minimized-end-btn" onClick={endCall}>×</button>
          </div>
        </div>
      );
    }

    return (
      <div className="fullscreen-call-overlay">
        <iframe
          id="callFrame"
          src={url}
          title="WebRTC Call"
          allow="camera; microphone; display-capture"
        />
      </div>
    );
  }

  return null;
}
