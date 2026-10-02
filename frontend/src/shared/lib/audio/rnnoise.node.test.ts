import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDenoiser, RNNOISE_SAMPLE_RATE } from './rnnoise';

/** Контекст-подделка: важны только частота и загрузка модуля worklet. */
function fakeContext(sampleRate: number, addModule = vi.fn().mockResolvedValue(undefined)) {
  return { sampleRate, audioWorklet: { addModule } } as unknown as AudioContext;
}

describe('createDenoiser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('не 48 кГц — шумодава нет, модуль даже не загружается', async () => {
    const addModule = vi.fn();
    const denoiser = await createDenoiser(fakeContext(44100, addModule));

    expect(denoiser).toBeNull();
    expect(addModule).not.toHaveBeenCalled();
  });

  it('модуль не загрузился — шумодава нет, звук не пропадает, причина в консоли', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const addModule = vi.fn().mockRejectedValue(new Error('CSP'));

    const denoiser = await createDenoiser(fakeContext(RNNOISE_SAMPLE_RATE, addModule));

    expect(denoiser).toBeNull();
    expect(addModule).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Шумоподавление RNNoise не запустилось, остаётся браузерное',
      expect.any(Error)
    );
  });
});
