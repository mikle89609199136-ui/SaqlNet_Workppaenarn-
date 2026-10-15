import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRingtoneActive, startRingtone, stopRingtone } from './callRingtone';

describe('callRingtone', () => {
  let mockOscillator: any;
  let mockGain: any;
  let mockAudioContext: any;
  let originalAudioContext: any;
  let originalVibrate: any;

  beforeEach(() => {
    vi.useFakeTimers();

    mockOscillator = {
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn().mockReturnThis(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn().mockReturnThis(),
    };

    mockAudioContext = {
      currentTime: 0,
      state: 'running',
      destination: {},
      createOscillator: vi.fn(() => ({ ...mockOscillator })),
      createGain: vi.fn(() => ({ ...mockGain })),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    originalAudioContext = (window as any).AudioContext;
    (window as any).AudioContext = class {
      constructor() {
        return mockAudioContext;
      }
    };

    originalVibrate = navigator.vibrate;
    (navigator as any).vibrate = vi.fn();
  });

  afterEach(() => {
    stopRingtone();
    vi.useRealTimers();
    (window as any).AudioContext = originalAudioContext;
    (navigator as any).vibrate = originalVibrate;
  });

  it('запускает рингтон немедленно при вызове без ожидания 2 секунд', () => {
    expect(isRingtoneActive()).toBe(false);

    startRingtone();

    expect(isRingtoneActive()).toBe(true);
    // Должен создаться AudioContext и сразу сгенерироваться 4 осциллятора (2 частоты x 2 импульса в пачке)
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(4);
    expect(mockAudioContext.createGain).toHaveBeenCalledTimes(4);
    expect(navigator.vibrate).toHaveBeenCalledWith([400, 200, 400, 1000]);

    // Перематываем на 2 секунды — срабатывает следующая пачка
    vi.advanceTimersByTime(2000);
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(8);
  });

  it('корректно останавливает рингтон, очищает таймеры, виброотклик и закрывает контекст', () => {
    startRingtone();
    expect(isRingtoneActive()).toBe(true);

    stopRingtone();

    expect(isRingtoneActive()).toBe(false);
    expect(navigator.vibrate).toHaveBeenCalledWith(0);
    expect(mockAudioContext.close).toHaveBeenCalledTimes(1);

    // Дальнейшие тики таймера не вызывают генерацию звука
    vi.advanceTimersByTime(4000);
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(4);
  });

  it('возобновляет приостановленный AudioContext при suspended состоянии', () => {
    mockAudioContext.state = 'suspended';

    startRingtone();

    expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);

    // Имитируем клик пользователя — должен повторно вызвать resume
    window.dispatchEvent(new Event('pointerdown'));
    expect(mockAudioContext.resume).toHaveBeenCalledTimes(2);

    stopRingtone();

    // После остановки слушатели сняты, клик больше не вызывает resume
    window.dispatchEvent(new Event('pointerdown'));
    expect(mockAudioContext.resume).toHaveBeenCalledTimes(2);
  });

  it('безопасно обрабатывает отсутствие поддержки AudioContext или ошибку конструктора', () => {
    (window as any).AudioContext = class {
      constructor() {
        throw new Error('NotAllowedError');
      }
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => startRingtone()).not.toThrow();
    expect(isRingtoneActive()).toBe(false);

    warnSpy.mockRestore();
  });
});
