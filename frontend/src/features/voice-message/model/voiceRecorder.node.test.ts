import { describe, expect, it, vi } from 'vitest';
import { MAX_VOICE_DURATION_MS, VOICE_WAVEFORM_BARS } from '@/shared/lib/voice';
import type { IOpusEncoder } from './opusEncoder';
import { VoiceRecorder, type IVoiceEnvironment } from './voiceRecorder';

const RATE = 48000;

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  private endedListeners: (() => void)[] = [];
  stop = vi.fn(() => {
    // Как в браузере: stop() не порождает события ended.
    this.readyState = 'ended';
  });
  addEventListener(type: string, listener: () => void) {
    if (type === 'ended') this.endedListeners.push(listener);
  }
  unplug() {
    this.readyState = 'ended';
    this.endedListeners.forEach((listener) => listener());
  }
}

function fakeStream(track = new FakeTrack()) {
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream,
  };
}

function setup(
  options: { getUserMedia?: () => Promise<MediaStream>; secure?: boolean; supported?: boolean } = {}
) {
  const { track, stream } = fakeStream();
  let emit: (samples: Float32Array) => void = () => {};
  const context = {
    sampleRate: RATE,
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
  };
  const encoder = {
    init: vi.fn(async () => undefined),
    encode: vi.fn(),
    finish: vi.fn(async () => [new Uint8Array([79, 103, 103, 83])]),
    close: vi.fn(),
  } satisfies IOpusEncoder;
  const getUserMedia = vi.fn(options.getUserMedia ?? (async () => stream));
  const env: IVoiceEnvironment = {
    isSecureContext: () => options.secure ?? true,
    isSupported: () => options.supported ?? true,
    getUserMedia,
    createAudioContext: () => context as unknown as AudioContext,
    createCapture: async () => ({
      node: { disconnect: vi.fn() } as unknown as AudioNode,
      onSamples: (listener) => {
        emit = listener;
      },
    }),
    createEncoder: () => encoder,
  };
  const recorder = new VoiceRecorder(env);
  /** Подать звук: столько миллисекунд, такой громкости. */
  const speak = (ms: number, amplitude = 0.3) => {
    for (let left = ms; left > 0; left -= 100) {
      emit(new Float32Array((RATE / 1000) * Math.min(100, left)).fill(amplitude));
    }
  };
  return { recorder, track, stream, context, encoder, getUserMedia, speak };
}

const released = (s: ReturnType<typeof setup>) => {
  expect(s.track.stop).toHaveBeenCalled();
  expect(s.context.close).toHaveBeenCalled();
  expect(s.encoder.close).toHaveBeenCalled();
};

describe('запись голосового (#843)', () => {
  it('записывает и отдаёт Ogg/Opus с длительностью и волной, микрофон освобождается', async () => {
    const s = setup();
    await s.recorder.start();
    expect(s.recorder.getState().status).toBe('recording');

    s.speak(2000);
    const recording = await s.recorder.finish();

    expect(recording?.blob.type).toBe('audio/ogg; codecs=opus');
    expect(recording?.meta.durationMs).toBe(2000);
    expect(recording?.meta.waveform).toHaveLength(VOICE_WAVEFORM_BARS);
    expect(s.encoder.encode).toHaveBeenCalled();
    expect(s.recorder.getState().status).toBe('idle');
    released(s);
  });

  it('живая волна — последние 40 уровней в 0…1', async () => {
    const s = setup();
    await s.recorder.start();
    s.speak(8000, 0.9);

    const { levels } = s.recorder.getState();
    expect(levels).toHaveLength(40);
    expect(levels.every((level) => level >= 0 && level <= 1)).toBe(true);
    s.recorder.cancel();
  });

  it('отпустили, пока браузер спрашивал разрешение: пришедший поток сразу гаснет', async () => {
    const { stream, track } = fakeStream();
    let grant: (value: MediaStream) => void = () => {};
    const s = setup({ getUserMedia: () => new Promise((resolve) => (grant = resolve)) });

    const starting = s.recorder.start();
    expect(s.recorder.getState().status).toBe('requesting');
    expect(await s.recorder.finish()).toBeNull(); // отпустили — это отмена

    grant(stream);
    await starting;

    expect(track.stop).toHaveBeenCalled();
    expect(s.recorder.getState().status).toBe('idle');
  });

  it.each([
    ['NotAllowedError', 'permission'],
    ['NotFoundError', 'no-device'],
    ['NotReadableError', 'busy'],
    ['SomethingElse', 'unknown'],
  ])('отказ %s — ошибка %s, кнопка не зависает', async (name, expected) => {
    const s = setup({ getUserMedia: () => Promise.reject(Object.assign(new Error(), { name })) });
    await s.recorder.start();

    expect(s.recorder.getState()).toMatchObject({ status: 'idle', error: expected });
  });

  it('небезопасный адрес и старый браузер — понятная ошибка без запроса микрофона', async () => {
    const insecure = setup({ secure: false });
    await insecure.recorder.start();
    expect(insecure.recorder.getState().error).toBe('insecure');
    expect(insecure.getUserMedia).not.toHaveBeenCalled();

    const old = setup({ supported: false });
    await old.recorder.start();
    expect(old.recorder.getState().error).toBe('unsupported');
    expect(old.getUserMedia).not.toHaveBeenCalled();
  });

  it('короче секунды — не отправляется, подсказка, микрофон свободен', async () => {
    const s = setup();
    await s.recorder.start();
    s.speak(600);

    expect(await s.recorder.finish()).toBeNull();
    expect(s.recorder.getState()).toMatchObject({ status: 'idle', error: 'too-short' });
    released(s);
  });

  it('15 минут — запись встаёт, закрепляется и её можно отправить', async () => {
    const s = setup();
    await s.recorder.start();
    s.speak(MAX_VOICE_DURATION_MS + 3000);

    expect(s.recorder.getState()).toMatchObject({ status: 'locked', limitReached: true });
    expect(s.track.stop).toHaveBeenCalled(); // микрофон уже не слушаем
    const recording = await s.recorder.finish();
    expect(recording?.meta.durationMs).toBe(MAX_VOICE_DURATION_MS);
  });

  it('выдернули микрофон — записанное сохраняется, предупреждение', async () => {
    const s = setup();
    await s.recorder.start();
    s.speak(3000);
    s.track.unplug();

    expect(s.recorder.getState()).toMatchObject({ status: 'locked', error: 'device-lost' });
    s.speak(1000); // после потери ничего не пишется
    const recording = await s.recorder.finish();
    expect(recording?.meta.durationMs).toBe(3000);
  });

  it('отмена посреди записи — ничего не отправляется, всё освобождено', async () => {
    const s = setup();
    await s.recorder.start();
    s.speak(3000);
    s.recorder.cancel();

    expect(await s.recorder.finish()).toBeNull();
    expect(s.encoder.finish).not.toHaveBeenCalled();
    released(s);
  });

  it('клик или клавиатура — сразу закреплённая запись; удержание закрепляется жестом', async () => {
    const clicked = setup();
    await clicked.recorder.start(true);
    expect(clicked.recorder.getState().status).toBe('locked');
    clicked.recorder.cancel();

    const held = setup();
    await held.recorder.start();
    held.recorder.lock();
    expect(held.recorder.getState().status).toBe('locked');
    held.recorder.cancel();
  });

  // Живой тест поймал: щелчок, пока грузился кодировщик, терялся — запись
  // шла «удерживаемой» без пальца на кнопке и не закреплялась.
  it('щелчок, пока выдаётся микрофон, закрепляет запись, когда она начнётся', async () => {
    const { stream } = fakeStream();
    let grant: (value: MediaStream) => void = () => {};
    const s = setup({ getUserMedia: () => new Promise((resolve) => (grant = resolve)) });

    const starting = s.recorder.start();
    s.recorder.lock();
    grant(stream);
    await starting;

    expect(s.recorder.getState().status).toBe('locked');
    s.recorder.cancel();
  });

  // Живой тест поймал: пока грузится кодировщик (WASM), первые ~0,8 с
  // пропадали — первое слово терялось.
  it('звук до готовности кодировщика копится и уходит в него по порядку', async () => {
    const s = setup();
    let ready: () => void = () => {};
    s.encoder.init.mockImplementationOnce(() => new Promise<void>((resolve) => (ready = resolve)));
    await s.recorder.start();
    expect(s.recorder.getState().status).toBe('recording'); // пишем, не дожидаясь кодировщика

    s.speak(800, 0.1);
    expect(s.encoder.encode).not.toHaveBeenCalled();
    ready();
    await Promise.resolve();
    expect(s.encoder.encode).toHaveBeenCalledTimes(8);

    s.speak(1200, 0.2);
    const recording = await s.recorder.finish();
    expect(recording?.meta.durationMs).toBe(2000);
    expect(s.encoder.encode).toHaveBeenCalledTimes(20);
  });

  it('кодировщик не запустился — запись прекращается сразу, микрофон свободен', async () => {
    const s = setup();
    s.encoder.init.mockRejectedValueOnce(new Error('нет WebAssembly'));
    await s.recorder.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(s.recorder.getState()).toMatchObject({ status: 'idle', error: 'unsupported' });
    released(s);
  });

  it('повторный старт во время записи ничего не ломает', async () => {
    const s = setup();
    await s.recorder.start();
    await s.recorder.start();

    expect(s.getUserMedia).toHaveBeenCalledTimes(1);
    s.recorder.cancel();
  });

  it('сбой кодировщика — запись не отправляется, микрофон свободен', async () => {
    const s = setup();
    s.encoder.finish.mockRejectedValueOnce(new Error('wasm'));
    await s.recorder.start();
    s.speak(2000);

    expect(await s.recorder.finish()).toBeNull();
    expect(s.recorder.getState().error).toBe('unknown');
    released(s);
  });
});
