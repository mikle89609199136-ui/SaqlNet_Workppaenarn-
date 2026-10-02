import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url&no-inline';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

/*
 * Шумоподавление RNNoise — общее для голосовых (#843) и звонков (#947).
 *
 * Модуль AudioWorklet — отдельный файл с того же адреса. `no-inline`
 * обязателен: маленький файл сборка иначе вшивает как `data:`-адрес, а
 * `data:` и `blob:` для скриптов запрещены политикой безопасности (CSP).
 */

/** RNNoise рассчитан на 48 кГц: на другой частоте он портит, а не чистит. */
export const RNNOISE_SAMPLE_RATE = 48000;

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;

/** WASM RNNoise — один раз на вкладку; не удалось — попробуем в следующий раз. */
export function loadRnnoiseBinary(): Promise<ArrayBuffer> {
  if (!rnnoiseBinary) {
    rnnoiseBinary = import('@sapphi-red/web-noise-suppressor')
      .then(({ loadRnnoise }) => loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl }))
      .catch((error) => {
        rnnoiseBinary = null;
        throw error;
      });
  }
  return rnnoiseBinary;
}

/** Узел шумоподавления: подключить между источником и потребителем, по окончании — `destroy()`. */
export interface IDenoiserNode extends AudioNode {
  destroy(): void;
}

/**
 * Узел RNNoise для контекста. Не получилось (не 48 кГц, не загрузился
 * WASM или модуль) — `null`: звук идёт с браузерным шумоподавлением, а не
 * пропадает.
 */
export async function createDenoiser(context: AudioContext): Promise<IDenoiserNode | null> {
  if (context.sampleRate !== RNNOISE_SAMPLE_RATE) return null;
  try {
    const [{ RnnoiseWorkletNode }, wasmBinary] = await Promise.all([
      import('@sapphi-red/web-noise-suppressor'),
      loadRnnoiseBinary(),
      context.audioWorklet.addModule(rnnoiseWorkletUrl),
    ]);
    return new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary });
  } catch (error) {
    console.warn('Шумоподавление RNNoise не запустилось, остаётся браузерное', error);
    return null;
  }
}
