interface IRingtoneHandle {
  ctx: AudioContext;
  ringtoneTimer: ReturnType<typeof setInterval>;
  vibrateTimer: ReturnType<typeof setInterval> | null;
  cleanupListeners: (() => void) | null;
}

let ringtoneHandle: IRingtoneHandle | null = null;

function playBurst(ctx: AudioContext): void {
  if (ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  [0, 0.5].forEach((offset) => {
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = 'sine';
    o1.frequency.value = 440;
    g1.gain.setValueAtTime(0, t0 + offset);
    g1.gain.linearRampToValueAtTime(0.55, t0 + offset + 0.04);
    g1.gain.setValueAtTime(0.55, t0 + offset + 0.32);
    g1.gain.linearRampToValueAtTime(0, t0 + offset + 0.4);

    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.value = 480;
    g2.gain.setValueAtTime(0, t0 + offset);
    g2.gain.linearRampToValueAtTime(0.45, t0 + offset + 0.04);
    g2.gain.setValueAtTime(0.45, t0 + offset + 0.32);
    g2.gain.linearRampToValueAtTime(0, t0 + offset + 0.4);

    o1.connect(g1).connect(ctx.destination);
    o2.connect(g2).connect(ctx.destination);

    o1.onended = () => {
      try {
        o1.disconnect();
        g1.disconnect();
      } catch {
        /* узел уже отключён */
      }
    };
    o2.onended = () => {
      try {
        o2.disconnect();
        g2.disconnect();
      } catch {
        /* узел уже отключён */
      }
    };

    o1.start(t0 + offset);
    o1.stop(t0 + offset + 0.42);
    o2.start(t0 + offset);
    o2.stop(t0 + offset + 0.42);
  });
}

/**
 * Запускает циклический рингтон входящего вызова (#1001).
 * Воспроизводит первый звуковой импульс немедленно при старте и повторяет каждые 2 секунды.
 * При блокировке Autoplay Policy регистрирует разблокировку при первом клике или нажатии клавиши.
 */
export function startRingtone(): void {
  stopRingtone();

  if (typeof window === 'undefined') return;

  let ctx: AudioContext | null = null;
  let ringtoneTimer: ReturnType<typeof setInterval> | null = null;
  let vibrateTimer: ReturnType<typeof setInterval> | null = null;
  let cleanupListeners: (() => void) | null = null;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return;

    ctx = new AudioContextClass();

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});

      const removeListeners = () => {
        window.removeEventListener('pointerdown', unlock, { capture: true });
        window.removeEventListener('keydown', unlock, { capture: true });
      };

      const unlock = () => {
        removeListeners();
        cleanupListeners = null;
        if (ringtoneHandle) {
          ringtoneHandle.cleanupListeners = null;
        }
        if (ctx && ctx.state === 'suspended') {
          void ctx
            .resume()
            .then(() => {
              if (ctx && ctx.state === 'running') {
                playBurst(ctx);
              }
            })
            .catch(() => {});
        }
      };

      window.addEventListener('pointerdown', unlock, { capture: true });
      window.addEventListener('keydown', unlock, { capture: true });
      cleanupListeners = removeListeners;
    } else {
      // Первый звуковой импульс сразу при активном контексте
      playBurst(ctx);
    }

    ringtoneTimer = setInterval(() => {
      if (ctx) {
        playBurst(ctx);
      }
    }, 2000);

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([400, 200, 400, 1000]);
        vibrateTimer = setInterval(() => {
          try {
            navigator.vibrate([400, 200, 400, 1000]);
          } catch {
            /* браузер заблокировал вибрацию без жеста */
          }
        }, 2000);
      } catch {
        /* вибрация недоступна или заблокирована */
      }
    }

    ringtoneHandle = { ctx, ringtoneTimer, vibrateTimer, cleanupListeners };
  } catch (e) {
    if (ringtoneTimer) clearInterval(ringtoneTimer);
    if (vibrateTimer) clearInterval(vibrateTimer);
    cleanupListeners?.();
    if (ctx && ctx.state !== 'closed') {
      try {
        void ctx.close();
      } catch {
        /* контекст уже закрыт */
      }
    }
    ringtoneHandle = null;
    console.warn('Ringtone failed:', e);
  }
}

/**
 * Останавливает рингтон, очищает таймеры, виброотклик и освобождает аудиоконтекст (#1001).
 */
export function stopRingtone(): void {
  if (!ringtoneHandle) return;

  clearInterval(ringtoneHandle.ringtoneTimer);
  if (ringtoneHandle.vibrateTimer) {
    clearInterval(ringtoneHandle.vibrateTimer);
  }

  ringtoneHandle.cleanupListeners?.();

  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(0);
    } catch {
      /* вибрация уже остановлена или недоступна */
    }
  }

  try {
    if (ringtoneHandle.ctx.state !== 'closed') {
      void ringtoneHandle.ctx.close();
    }
  } catch {
    /* контекст уже закрыт */
  }

  ringtoneHandle = null;
}

/**
 * Проверяет, играет ли рингтон в данный момент.
 */
export function isRingtoneActive(): boolean {
  return ringtoneHandle !== null;
}
