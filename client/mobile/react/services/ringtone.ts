interface IRingtoneHandle {
  ctx: AudioContext;
  ringtoneTimer: ReturnType<typeof setInterval>;
  vibrateTimer: ReturnType<typeof setInterval> | null;
}

let ringtoneHandle: IRingtoneHandle | null = null;

export function startRingtone(): void {
  stopRingtone();
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioContextClass();

    const ringtoneTimer = setInterval(() => {
      const t0 = ctx.currentTime;
      [0, 0.5].forEach((offset) => {
        const o1 = ctx.createOscillator();
        const g1 = ctx.createGain();
        o1.type = "sine";
        o1.frequency.value = 440;
        g1.gain.setValueAtTime(0, t0 + offset);
        g1.gain.linearRampToValueAtTime(0.55, t0 + offset + 0.04);
        g1.gain.setValueAtTime(0.55, t0 + offset + 0.32);
        g1.gain.linearRampToValueAtTime(0, t0 + offset + 0.4);

        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = "sine";
        o2.frequency.value = 480;
        g2.gain.setValueAtTime(0, t0 + offset);
        g2.gain.linearRampToValueAtTime(0.45, t0 + offset + 0.04);
        g2.gain.setValueAtTime(0.45, t0 + offset + 0.32);
        g2.gain.linearRampToValueAtTime(0, t0 + offset + 0.4);

        o1.connect(g1).connect(ctx.destination);
        o2.connect(g2).connect(ctx.destination);

        o1.start(t0 + offset);
        o1.stop(t0 + offset + 0.42);
        o2.start(t0 + offset);
        o2.stop(t0 + offset + 0.42);
      });
    }, 2000);

    let vibrateTimer: ReturnType<typeof setInterval> | null = null;
    if (navigator.vibrate) {
      navigator.vibrate([400, 200, 400, 1000]);
      vibrateTimer = setInterval(() => {
        navigator.vibrate([400, 200, 400, 1000]);
      }, 2000);
    }

    ringtoneHandle = { ctx, ringtoneTimer, vibrateTimer };
  } catch (e) {
    console.warn("Ringtone failed:", e);
  }
}

export function stopRingtone(): void {
  if (!ringtoneHandle) return;
  clearInterval(ringtoneHandle.ringtoneTimer);
  if (ringtoneHandle.vibrateTimer) clearInterval(ringtoneHandle.vibrateTimer);
  try {
    navigator.vibrate?.(0);
  } catch {}
  try {
    ringtoneHandle.ctx.close();
  } catch {}
  ringtoneHandle = null;
}