import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalMediaManager, parseMediaError } from './localMedia';

// Mock Web API классов для Node окружения
class FakeMediaStreamTrack {
  kind: 'audio' | 'video';
  id: string;
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });

  constructor(kind: 'audio' | 'video', id = `${kind}-${Math.random().toString(36).slice(2)}`) {
    this.kind = kind;
    this.id = id;
  }
}

class FakeMediaStream {
  private tracks: FakeMediaStreamTrack[] = [];

  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }

  getVideoTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }

  addTrack(track: FakeMediaStreamTrack): void {
    if (!this.tracks.includes(track)) {
      this.tracks.push(track);
    }
  }

  removeTrack(track: FakeMediaStreamTrack): void {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
}

describe('parseMediaError', () => {
  it('классифицирует NotAllowedError / PermissionDeniedError', () => {
    const err = parseMediaError({ name: 'NotAllowedError' });
    expect(err.type).toBe('NotAllowedError');
    expect(err.message).toBe('Permission denied');

    const err2 = parseMediaError({ name: 'PermissionDeniedError' });
    expect(err2.type).toBe('NotAllowedError');
  });

  it('классифицирует NotFoundError / DevicesNotFoundError', () => {
    const err = parseMediaError({ name: 'NotFoundError' });
    expect(err.type).toBe('NotFoundError');
    expect(err.message).toBe('Requested device not found');

    const err2 = parseMediaError({ name: 'DevicesNotFoundError' });
    expect(err2.type).toBe('NotFoundError');
  });

  it('классифицирует NotReadableError / TrackStartError (устройство занято)', () => {
    const err = parseMediaError({ name: 'NotReadableError' });
    expect(err.type).toBe('NotReadableError');
    expect(err.message).toBe('Device is not readable or already in use');

    const err2 = parseMediaError({ name: 'TrackStartError' });
    expect(err2.type).toBe('NotReadableError');
  });

  it('классифицирует OverconstrainedError', () => {
    const err = parseMediaError({ name: 'OverconstrainedError' });
    expect(err.type).toBe('OverconstrainedError');
    expect(err.message).toBe('Overconstrained track settings');
  });

  it('классифицирует InsecureContextError', () => {
    const err = parseMediaError({ name: 'InsecureContextError' });
    expect(err.type).toBe('InsecureContextError');
    expect(err.message).toBe('Media devices not available in insecure context');
  });

  it('классифицирует TimeoutError', () => {
    const err = parseMediaError({ name: 'TimeoutError' });
    expect(err.type).toBe('TimeoutError');
    expect(err.message).toBe('Media permission request timed out');
  });

  it('обрабатывает неизвестные ошибки с fallback сообщением', () => {
    const err = parseMediaError({ name: 'SomeOtherError', message: 'Custom failure' });
    expect(err.type).toBe('UnknownMediaError');
    expect(err.message).toBe('Custom failure');

    const errNull = parseMediaError(null);
    expect(errNull.type).toBe('UnknownMediaError');
    expect(errNull.message).toBe('Unknown media error');
  });
});

describe('LocalMediaManager', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>;
  let mockEnumerateDevices: ReturnType<typeof vi.fn>;
  let mockAddEventListener: ReturnType<typeof vi.fn>;
  let mockRemoveEventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetUserMedia = vi.fn();
    mockEnumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Default Mic', groupId: 'g1' },
      { deviceId: 'cam-1', kind: 'videoinput', label: 'Front Camera', groupId: 'g2' },
      { deviceId: 'cam-2', kind: 'videoinput', label: 'Back Camera', groupId: 'g3' },
    ]);
    mockAddEventListener = vi.fn();
    mockRemoveEventListener = vi.fn();

    // Stub navigator.mediaDevices
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: mockGetUserMedia,
        enumerateDevices: mockEnumerateDevices,
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('возвращает InsecureContextError, если navigator.mediaDevices отсутствует', async () => {
    vi.stubGlobal('navigator', {});
    const manager = new LocalMediaManager();
    const stream = await manager.startMedia();

    expect(stream).toBeNull();
    const state = manager.getState();
    expect(state.error?.type).toBe('InsecureContextError');
  });

  it('запрашивает видео и аудио при видеозвонке по умолчанию', async () => {
    const aTrack = new FakeMediaStreamTrack('audio');
    const vTrack = new FakeMediaStreamTrack('video');
    const fakeStream = new FakeMediaStream([aTrack, vTrack]);
    mockGetUserMedia.mockResolvedValueOnce(fakeStream);

    const manager = new LocalMediaManager();
    const stream = await manager.startMedia();

    expect(stream).toBe(fakeStream);
    expect(mockGetUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.any(Object),
        video: expect.any(Object),
      })
    );

    const state = manager.getState();
    expect(state.stream).toBe(fakeStream);
    expect(state.audioTrack).toBe(aTrack);
    expect(state.videoTrack).toBe(vTrack);
    expect(state.error).toBeNull();
    expect(state.audioInputs.length).toBe(1);
    expect(state.videoInputs.length).toBe(2);
  });

  it('запрашивает только аудио при аудиозвонке (kind: audio)', async () => {
    const aTrack = new FakeMediaStreamTrack('audio');
    const fakeStream = new FakeMediaStream([aTrack]);
    mockGetUserMedia.mockResolvedValueOnce(fakeStream);

    const manager = new LocalMediaManager();
    const stream = await manager.startMedia({ kind: 'audio' });

    expect(stream).toBe(fakeStream);
    expect(mockGetUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.any(Object),
        video: false,
      })
    );

    const state = manager.getState();
    expect(state.videoTrack).toBeNull();
  });

  it('управляет микрофоном и камерой через track.enabled без повторного запроса getUserMedia', async () => {
    const aTrack = new FakeMediaStreamTrack('audio');
    const vTrack = new FakeMediaStreamTrack('video');
    const fakeStream = new FakeMediaStream([aTrack, vTrack]);
    mockGetUserMedia.mockResolvedValueOnce(fakeStream);

    const manager = new LocalMediaManager();
    await manager.startMedia();

    // 1 вызов getUserMedia при старте
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);

    // Выключаем микрофон
    const micOff = manager.toggleAudio(false);
    expect(micOff).toBe(false);
    expect(aTrack.enabled).toBe(false);
    expect(manager.getState().isAudioMuted).toBe(true);

    // Включаем микрофон обратно
    const micOn = manager.toggleAudio(true);
    expect(micOn).toBe(true);
    expect(aTrack.enabled).toBe(true);
    expect(manager.getState().isAudioMuted).toBe(false);

    // Выключаем камеру
    const camOff = manager.toggleVideo(false);
    expect(camOff).toBe(false);
    expect(vTrack.enabled).toBe(false);
    expect(manager.getState().isVideoMuted).toBe(true);

    // Никаких дополнительных вызовов getUserMedia
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
  });

  it('горячая смена камеры останавливает старый видеотрек и уведомляет слушателей', async () => {
    const oldVTrack = new FakeMediaStreamTrack('video', 'cam-old');
    const aTrack = new FakeMediaStreamTrack('audio', 'mic-1');
    const stream = new FakeMediaStream([aTrack, oldVTrack]);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const manager = new LocalMediaManager();
    await manager.startMedia();

    const newVTrack = new FakeMediaStreamTrack('video', 'cam-new');
    const tempStream = new FakeMediaStream([newVTrack]);
    mockGetUserMedia.mockResolvedValueOnce(tempStream);

    const onTrackReplaced = vi.fn();
    manager.onTrackReplaced(onTrackReplaced);

    // Меняем камеру на 'cam-2'
    const resultTrack = await manager.switchCamera('cam-2');

    expect(resultTrack).toBe(newVTrack);
    // Старый трек камеры остановлен (индикатор гаснет)
    expect(oldVTrack.stop).toHaveBeenCalled();
    expect(oldVTrack.readyState).toBe('ended');

    // Новый трек помещён в стрим
    expect(manager.getState().videoTrack).toBe(newVTrack);
    expect(manager.getState().stream?.getVideoTracks()).toEqual([newVTrack]);

    // Коллбэк замены трека вызван с ('video', oldTrack, newTrack)
    expect(onTrackReplaced).toHaveBeenCalledWith('video', oldVTrack, newVTrack);
  });

  it('переключает селфи/основную камеру по facingMode (user <-> environment)', async () => {
    const oldVTrack = new FakeMediaStreamTrack('video');
    const stream = new FakeMediaStream([oldVTrack]);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const manager = new LocalMediaManager();
    await manager.startMedia();
    expect(manager.getState().facingMode).toBe('user');

    const envTrack = new FakeMediaStreamTrack('video');
    mockGetUserMedia.mockResolvedValueOnce(new FakeMediaStream([envTrack]));

    // Переключение без параметров циклически меняет facingMode
    await manager.switchCamera();

    expect(manager.getState().facingMode).toBe('environment');
    expect(mockGetUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({
        video: { facingMode: 'environment' },
      })
    );
  });

  it('горячая смена микрофона останавливает старый аудиотрек', async () => {
    const oldATrack = new FakeMediaStreamTrack('audio', 'mic-old');
    const stream = new FakeMediaStream([oldATrack]);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const manager = new LocalMediaManager();
    await manager.startMedia();

    const newATrack = new FakeMediaStreamTrack('audio', 'mic-new');
    mockGetUserMedia.mockResolvedValueOnce(new FakeMediaStream([newATrack]));

    const onTrackReplaced = vi.fn();
    manager.onTrackReplaced(onTrackReplaced);

    await manager.switchMicrophone('mic-external');

    expect(oldATrack.stop).toHaveBeenCalled();
    expect(manager.getState().audioTrack).toBe(newATrack);
    expect(onTrackReplaced).toHaveBeenCalledWith('audio', oldATrack, newATrack);
  });

  it('полная уборка ресурсов при завершении: останавливает все треки и гасит индикаторы', async () => {
    const aTrack = new FakeMediaStreamTrack('audio');
    const vTrack = new FakeMediaStreamTrack('video');
    const stream = new FakeMediaStream([aTrack, vTrack]);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const manager = new LocalMediaManager();
    await manager.startMedia();

    expect(aTrack.readyState).toBe('live');
    expect(vTrack.readyState).toBe('live');

    // Завершаем звонок / медиа
    manager.stopMedia();

    expect(aTrack.stop).toHaveBeenCalled();
    expect(vTrack.stop).toHaveBeenCalled();
    expect(aTrack.readyState).toBe('ended');
    expect(vTrack.readyState).toBe('ended');

    const state = manager.getState();
    expect(state.stream).toBeNull();
    expect(state.audioTrack).toBeNull();
    expect(state.videoTrack).toBeNull();
    expect(mockRemoveEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
  });

  it('отбой во время запроса разрешения не оставляет камеру включённой', async () => {
    let resolveGUM!: (stream: FakeMediaStream) => void;
    mockGetUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGUM = resolve;
        })
    );

    const aTrack = new FakeMediaStreamTrack('audio');
    const vTrack = new FakeMediaStreamTrack('video');
    const stream = new FakeMediaStream([aTrack, vTrack]);

    const manager = new LocalMediaManager();
    // Начинаем запрос медиа (браузер ждёт клика пользователя)
    const startPromise = manager.startMedia();

    // Пользователь отменяет звонок до ответа браузера
    manager.stopMedia();

    // Пользователь нажал «Разрешить» в браузере
    resolveGUM(stream);
    const result = await startPromise;

    // Стрим не сохранён
    expect(result).toBeNull();
    expect(manager.getState().stream).toBeNull();

    // Треки немедленно остановлены (индикатор не горит)
    expect(aTrack.stop).toHaveBeenCalled();
    expect(vTrack.stop).toHaveBeenCalled();
  });

  it('видеозвонок без камеры откатывается на аудиозвонок голосом', async () => {
    // Первый вызов с видео падает (камера не найдена)
    mockGetUserMedia.mockRejectedValueOnce({ name: 'NotFoundError', message: 'No camera' });

    // Повторный запрос только с аудио успешен
    const aTrack = new FakeMediaStreamTrack('audio');
    const audioStream = new FakeMediaStream([aTrack]);
    mockGetUserMedia.mockResolvedValueOnce(audioStream);

    const manager = new LocalMediaManager();
    const result = await manager.startMedia({ kind: 'video' });

    expect(result).toBe(audioStream);
    const state = manager.getState();
    expect(state.audioTrack).toBe(aTrack);
    expect(state.videoTrack).toBeNull();
    expect(state.isVideoMuted).toBe(true);
    // Ошибка камеры зафиксирована для подсказки в интерфейсе
    expect(state.error?.type).toBe('NotFoundError');
  });

  it('switchCamera в голосовом звонке не открывает камеру', async () => {
    const aTrack = new FakeMediaStreamTrack('audio');
    const audioStream = new FakeMediaStream([aTrack]);
    mockGetUserMedia.mockResolvedValueOnce(audioStream);

    const manager = new LocalMediaManager();
    await manager.startMedia({ kind: 'audio' });

    const switched = await manager.switchCamera('cam-1');
    expect(switched).toBeNull();
  });

  it('обрабатывает отключение устройства посреди звонка через track.onended', async () => {
    const aTrack = new FakeMediaStreamTrack('audio');
    const vTrack = new FakeMediaStreamTrack('video');
    const stream = new FakeMediaStream([aTrack, vTrack]);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const manager = new LocalMediaManager();
    await manager.startMedia();

    // Симулируем отключение гарнитуры / микрофона
    aTrack.onended?.();

    expect(manager.getState().audioTrack).toBeNull();
    expect(manager.getState().error?.type).toBe('NotFoundError');
    expect(manager.getState().error?.message).toBe('Audio device disconnected');
  });

  it('switchMicrophone при ошибке переключения откатывается на предыдущий микрофон', async () => {
    const oldATrack = new FakeMediaStreamTrack('audio', 'mic-old');
    mockGetUserMedia.mockResolvedValueOnce(new FakeMediaStream([oldATrack]));

    const manager = new LocalMediaManager();
    await manager.startMedia();

    // Первый вызов switchMicrophone падает с NotReadableError
    mockGetUserMedia.mockRejectedValueOnce({ name: 'NotReadableError', message: 'Device busy' });

    // Повторный вызов отката на старый микрофон успешен
    const restoredATrack = new FakeMediaStreamTrack('audio', 'mic-restored');
    mockGetUserMedia.mockResolvedValueOnce(new FakeMediaStream([restoredATrack]));

    const onTrackReplaced = vi.fn();
    manager.onTrackReplaced(onTrackReplaced);

    const switched = await manager.switchMicrophone('mic-broken');

    expect(switched).toBeNull();
    expect(manager.getState().audioTrack).toBe(restoredATrack);
    expect(manager.getState().error?.type).toBe('NotReadableError');
    expect(onTrackReplaced).toHaveBeenCalledWith('audio', oldATrack, restoredATrack);
  });

  it('switchCamera при ошибке переключения откатывается на предыдущую камеру', async () => {
    const oldVTrack = new FakeMediaStreamTrack('video', 'cam-old');
    const aTrack = new FakeMediaStreamTrack('audio', 'mic-1');
    mockGetUserMedia.mockResolvedValueOnce(new FakeMediaStream([aTrack, oldVTrack]));

    const manager = new LocalMediaManager();
    await manager.startMedia();

    // Переключение на сломанную камеру падает
    mockGetUserMedia.mockRejectedValueOnce({ name: 'NotReadableError', message: 'Camera in use' });

    // Откат успешен
    const restoredVTrack = new FakeMediaStreamTrack('video', 'cam-restored');
    mockGetUserMedia.mockResolvedValueOnce(new FakeMediaStream([restoredVTrack]));

    const onTrackReplaced = vi.fn();
    manager.onTrackReplaced(onTrackReplaced);

    const switched = await manager.switchCamera('cam-broken');

    expect(switched).toBeNull();
    expect(manager.getState().videoTrack).toBe(restoredVTrack);
    expect(manager.getState().error?.type).toBe('NotReadableError');
    expect(onTrackReplaced).toHaveBeenCalledWith('video', oldVTrack, restoredVTrack);
  });

  it('switchCamera и switchMicrophone возвращают null, если идет isLoading', async () => {
    mockGetUserMedia.mockImplementation(() => new Promise(() => {}));

    const manager = new LocalMediaManager();
    void manager.startMedia();

    expect(manager.getState().isLoading).toBe(true);

    const camResult = await manager.switchCamera('cam-2');
    const micResult = await manager.switchMicrophone('mic-2');

    expect(camResult).toBeNull();
    expect(micResult).toBeNull();
  });

  it('startMedia завершается с TimeoutError при истечении timeoutMs', async () => {
    vi.useFakeTimers();
    mockGetUserMedia.mockImplementation(() => new Promise(() => {}));

    const manager = new LocalMediaManager();
    const startPromise = manager.startMedia({ timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1001);
    const stream = await startPromise;

    expect(stream).toBeNull();
    expect(manager.getState().isLoading).toBe(false);
    expect(manager.getState().error?.type).toBe('TimeoutError');

    vi.useRealTimers();
  });

  it('глушит треки стрима, если getUserMedia разрешился после наступления тайм-аута', async () => {
    vi.useFakeTimers();
    let resolveLateGUM!: (stream: FakeMediaStream) => void;
    mockGetUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLateGUM = resolve;
        })
    );

    const aTrack = new FakeMediaStreamTrack('audio');
    const vTrack = new FakeMediaStreamTrack('video');
    const fakeStream = new FakeMediaStream([aTrack, vTrack]);

    const manager = new LocalMediaManager();
    const startPromise = manager.startMedia({ timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1001);
    const result = await startPromise;

    expect(result).toBeNull();
    expect(manager.getState().error?.type).toBe('TimeoutError');

    // Пользователь нажал «Разрешить» позже тайм-аута
    resolveLateGUM(fakeStream);
    await Promise.resolve();

    expect(aTrack.stop).toHaveBeenCalled();
    expect(vTrack.stop).toHaveBeenCalled();
    expect(manager.getState().stream).toBeNull();

    vi.useRealTimers();
  });

  it('startMedia отменяет и останавливает идущую параллельно смену устройства', async () => {
    const initialATrack = new FakeMediaStreamTrack('audio', 'mic-1');
    const initialStream = new FakeMediaStream([initialATrack]);
    mockGetUserMedia.mockResolvedValueOnce(initialStream);

    const manager = new LocalMediaManager();
    await manager.startMedia();

    let resolveSwitchMic!: (stream: FakeMediaStream) => void;
    mockGetUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSwitchMic = resolve;
        })
    );

    const switchPromise = manager.switchMicrophone('mic-2');

    // Во время смены запускается новый startMedia
    const newATrack = new FakeMediaStreamTrack('audio', 'mic-new-start');
    mockGetUserMedia.mockResolvedValueOnce(new FakeMediaStream([newATrack]));
    await manager.startMedia({ kind: 'audio' });

    // Повиснувшая смена микрофона наконец завершается
    const lateSwitchTrack = new FakeMediaStreamTrack('audio', 'mic-switch-late');
    resolveSwitchMic(new FakeMediaStream([lateSwitchTrack]));
    const switchResult = await switchPromise;

    expect(switchResult).toBeNull();
    expect(lateSwitchTrack.stop).toHaveBeenCalled();
    expect(manager.getState().audioTrack).toBe(newATrack);
  });
});
