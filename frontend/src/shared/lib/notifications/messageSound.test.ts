import { afterEach, describe, expect, it, vi } from 'vitest';
import { playMessageSound, stopMessageSound } from './messageSound';

function context(state: AudioContextState = 'running') {
  const oscillator = {
    type: '',
    frequency: { value: 0 },
    connect: vi.fn().mockReturnThis(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: null as (() => void) | null,
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
  };
  const ctx = {
    state,
    currentTime: 0,
    destination: {},
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    close: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn(),
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return ctx;
      }
    }
  );
  return { ctx, oscillator };
}
afterEach(() => {
  stopMessageSound();
  vi.unstubAllGlobals();
});
describe('короткий звук сообщения', () => {
  it('играет только при действующем допуске и освобождает audio nodes', async () => {
    const { ctx, oscillator } = context();
    await playMessageSound(() => true);
    expect(oscillator.start).toHaveBeenCalledOnce();
    expect(oscillator.stop).toHaveBeenCalledWith(0.18);
    oscillator.onended?.();
    expect(oscillator.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalledOnce();
  });
  it('при запрете не создаёт oscillator', async () => {
    const { ctx } = context();
    await playMessageSound(() => false);
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });
  it('не ставит заблокированный autoplay в очередь и не разблокирует его позже', async () => {
    const { ctx } = context('suspended');
    await playMessageSound(() => true);
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('pointerdown'));
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });
});
