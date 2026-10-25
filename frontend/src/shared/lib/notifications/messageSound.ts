let current: AudioContext | null = null;

/** Короткий сигнал. Запрещённый autoplay не ставит звук в очередь до будущего жеста. */
export async function playMessageSound(allowed: () => boolean): Promise<void> {
  if (!allowed() || typeof window === 'undefined') return;
  const Context =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  stopMessageSound();
  let ctx: AudioContext | null = null;
  try {
    ctx = new Context();
    current = ctx;
    if (ctx.state !== 'running' || !allowed()) {
      stopMessageSound();
      return;
    }
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const time = ctx.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.15, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      if (current === ctx) stopMessageSound();
    };
    oscillator.start(time);
    oscillator.stop(time + 0.18);
  } catch {
    if (current === ctx) stopMessageSound();
  }
}
export function stopMessageSound(): void {
  const ctx = current;
  current = null;
  if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
}
