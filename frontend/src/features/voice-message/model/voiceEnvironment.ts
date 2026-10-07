import { createDenoiser, loadRnnoiseBinary } from '@/shared/lib/audio';
import encoderWorkerUrl from 'opus-recorder/dist/encoderWorker.min.js?url';
import captureModuleUrl from './pcmCapture.worklet.js?url&no-inline';
import { createOpusEncoder } from './opusEncoder';
import type { IVoiceEnvironment } from './voiceRecorder';

/*
 * Модуль захвата AudioWorklet — отдельный файл с того же адреса. `no-inline`
 * обязателен: маленький файл сборка иначе вшивает как `data:`-адрес, а
 * `data:` и `blob:` для скриптов запрещены политикой безопасности (CSP).
 * Шумоподавление RNNoise — общее со звонками, в `shared/lib/audio`.
 */

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
