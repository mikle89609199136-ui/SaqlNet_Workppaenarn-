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

  it('немедленно прекращает последующие пачки/вибрацию после запрета', () => {
    let allowed = true;
    startRingtone(() => allowed);
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(4);
    allowed = false;
    vi.advanceTimersByTime(2000);
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(4);
    expect(isRingtoneActive()).toBe(false);
    expect(navigator.vibrate).toHaveBeenLastCalledWith(0);
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

  it('не накапливает пачки звука при suspended состоянии и играет после разблокировки жестом', async () => {
    mockAudioContext.state = 'suspended';

    startRingtone();

    expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
    // Пока suspended, пачки не создаются
    expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();

    // Прошло 4 секунды (2 тика таймера) в suspended состоянии — пачки не копятся
    vi.advanceTimersByTime(4000);
    expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();

    // Имитируем клик пользователя с переходом в running
    mockAudioContext.resume.mockImplementation(async () => {
      mockAudioContext.state = 'running';
    });
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();

    expect(mockAudioContext.resume).toHaveBeenCalledTimes(2);
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(4);

    // Слушатели сняты: последующий keydown не вызывает resume
    window.dispatchEvent(new Event('keydown'));
    expect(mockAudioContext.resume).toHaveBeenCalledTimes(2);

    stopRingtone();
  });

  it('не роняет рингтон и корректно останавливается при ошибке SecurityError в navigator.vibrate', () => {
    (navigator as any).vibrate = vi.fn(() => {
      throw new Error('SecurityError');
    });

    expect(() => startRingtone()).not.toThrow();
    expect(isRingtoneActive()).toBe(true);

    // Таймер работает и звук играет
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(4);

    stopRingtone();
    expect(isRingtoneActive()).toBe(false);
  });

  it('отключает узлы oscillator и gain при завершении воспроизведения импульса', () => {
    let capturedOscillator: any = null;
    let capturedGain: any = null;
    mockAudioContext.createOscillator = vi.fn(() => {
      capturedOscillator = {
        ...mockOscillator,
        disconnect: vi.fn(),
      };
      return capturedOscillator;
    });
    mockAudioContext.createGain = vi.fn(() => {
      capturedGain = {
        ...mockGain,
        disconnect: vi.fn(),
      };
      return capturedGain;
    });

    startRingtone();
    expect(capturedOscillator).toBeDefined();
    expect(capturedGain).toBeDefined();

    // Симулируем событие onended
    capturedOscillator.onended();
    expect(capturedOscillator.disconnect).toHaveBeenCalledTimes(1);
    expect(capturedGain.disconnect).toHaveBeenCalledTimes(1);
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
