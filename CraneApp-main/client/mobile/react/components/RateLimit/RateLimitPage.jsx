import { useCountdown } from '../../hooks/useCountdown.js';

const RING_RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function RateLimitPage({ retryAfter, onBack, t = fallbackTranslate }) {
  const { initialSeconds, isComplete, remaining } = useCountdown(retryAfter);
  const progress = remaining / initialSeconds;
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <main className="card">
      <div className="logo">CraneApp</div>

      <span className="emoji-wrap" aria-hidden="true">🚦</span>

      <div className="status-badge">
        <div className="status-dot" />
        {t('rateLimitBadge', 'Лимит запросов')}
      </div>

      <h1>{t('rateLimitTitle', 'Притормози немного')}</h1>
      <p>{t('rateLimitDescription', 'Ты отправляешь запросы слишком быстро. Подожди немного — и всё заработает снова.')}</p>

      <div className="timer-wrap">
        <div className="timer-ring">
          <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
            <circle className="ring-bg" cx="50" cy="50" r={RING_RADIUS} />
            <circle
              className="ring-bar"
              cx="50"
              cy="50"
              r={RING_RADIUS}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              style={{ stroke: isComplete ? '#00E676' : undefined }}
            />
          </svg>
          <div className="timer-num" aria-live="polite">{isComplete ? '✓' : remaining}</div>
        </div>
        <div className="timer-label">{t('rateLimitTimerLabel', 'секунд до разблокировки')}</div>
      </div>

      <button className="retry-btn" type="button" onClick={onBack} disabled={!isComplete}>
        <BackIcon />
        {t('backReturn', 'Вернуться назад')}
      </button>
    </main>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function fallbackTranslate(_key, fallback) {
  return fallback;
}
