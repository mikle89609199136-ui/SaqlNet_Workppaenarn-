import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url&no-inline';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import encoderWorkerUrl from 'opus-recorder/dist/encoderWorker.min.js?url';
import captureModuleUrl from './pcmCapture.worklet.js?url&no-inline';
import { createOpusEncoder } from './opusEncoder';
import type { IVoiceEnvironment } from './voiceRecorder';

/*
 * Модули AudioWorklet — отдельные файлы с того же адреса. `no-inline`
 * обязателен: маленький файл сборка иначе вшивает как `data:`-адрес, а
 * `data:` и `blob:` для скриптов запрещены политикой безопасности (CSP).
 */

/** RNNoise рассчитан на 48 кГц: на другой частоте он портит, а не чистит. */
const RNNOISE_SAMPLE_RATE = 48000;

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;

/** WASM RNNoise — один раз на вкладку; не удалось — попробуем в следующий раз. */
function loadRnnoiseBinary(): Promise<ArrayBuffer> {
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

/**
 * Шумоподавление RNNoise (#843) — узел перед захватом. Не получилось
 * (нет 48 кГц, не загрузился WASM) — `null`: запись идёт с браузерным
 * шумоподавлением, а не падает.
 */
async function createDenoiser(context: AudioContext) {
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

/** Браузер: микрофон, AudioWorklet, шумоподавление и воркер кодировщика (#843). */
export const browserVoiceEnvironment: IVoiceEnvironment = {
  denoises: true,

  isSecureContext: () =>
    typeof window !== 'undefined' &&
    window.isSecureContext !== false &&
    Boolean(navigator.mediaDevices?.getUserMedia),

  isSupported: () =>
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    typeof Worker !== 'undefined',

  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),

  createAudioContext: () => new AudioContext(),

  async createCapture(context) {
    const [denoiser] = await Promise.all([
      createDenoiser(context),
      context.audioWorklet.addModule(captureModuleUrl),
    ]);
    const capture = new AudioWorkletNode(context, 'craneapp-pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    // Узел, не подключённый к выходу, браузер вправе не обрабатывать.
    // Подключаем через нулевую громкость: слышно ничего не будет.
    const silence = context.createGain();
    silence.gain.value = 0;
    capture.connect(silence).connect(context.destination);
    denoiser?.connect(capture);

    return {
      node: denoiser ?? capture,
      denoised: Boolean(denoiser),
      onSamples(listener) {
        capture.port.onmessage = (event: MessageEvent<Float32Array>) => listener(event.data);
      },
      dispose() {
        capture.port.onmessage = null;
        try {
          denoiser?.disconnect();
          denoiser?.destroy();
        } catch {
          // Уже освобождён.
        }
      },
    };
  },

  createEncoder: createOpusEncoder,

  preload() {
    // Кодировщик и шумодав — в кеш браузера заранее, чтобы запись
    // начиналась без ожидания загрузки. Ошибки не важны: при записи
    // загрузка повторится.
    void fetch(encoderWorkerUrl).catch(() => undefined);
    void loadRnnoiseBinary().catch(() => undefined);
  },
};
