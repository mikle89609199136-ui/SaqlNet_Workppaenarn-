import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWav, resetPlaybackSupport, toPlayableVoiceBlob } from './playableVoice';

const decodeFile = vi.fn();
vi.mock('ogg-opus-decoder', () => ({
  OggOpusDecoder: class {
    ready = Promise.resolve();
    decodeFile = decodeFile;
    free = vi.fn();
  },
}));

afterEach(() => {
  resetPlaybackSupport();
  decodeFile.mockReset();
});

describe('голосовое, которое браузер проиграет (#843)', () => {
  it('браузер сам проигрывает Ogg/Opus — файл как есть, декодер не грузится', async () => {
    resetPlaybackSupport(true);
    const blob = new Blob(['ogg'], { type: 'audio/ogg; codecs=opus' });

    expect(await toPlayableVoiceBlob(blob)).toBe(blob);
    expect(decodeFile).not.toHaveBeenCalled();
  });

  it('не проигрывает — перекодируется в WAV 16 кГц моно', async () => {
    resetPlaybackSupport(false);
    decodeFile.mockResolvedValue({
      channelData: [new Float32Array(48000).fill(0.5)],
      sampleRate: 48000,
    });

    const playable = await toPlayableVoiceBlob(new Blob(['ogg']));

    expect(playable.type).toBe('audio/wav');
    const view = new DataView(await playable.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(16000); // частота
    expect(view.getUint16(22, true)).toBe(1); // моно
    expect(view.getUint32(40, true)).toBe(16000 * 2); // секунда, 16 бит
  });

  it('декодер упал — исходный файл: плеер предложит скачать', async () => {
    resetPlaybackSupport(false);
    decodeFile.mockRejectedValue(new Error('битый файл'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blob = new Blob(['ogg']);

    try {
      expect(await toPlayableVoiceBlob(blob)).toBe(blob);
    } finally {
      warn.mockRestore();
    }
  });

  it('WAV: заголовок RIFF и отсчёты в пределах 16 бит', async () => {
    const wav = encodeWav(new Float32Array([2, -2, 0.5]), 16000, 16000);
    const bytes = new Uint8Array(await wav.arrayBuffer());

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
