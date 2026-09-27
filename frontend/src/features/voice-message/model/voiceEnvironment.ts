import captureModuleUrl from './pcmCapture.worklet.js?url&no-inline';
import { createOpusEncoder } from './opusEncoder';
import type { IVoiceEnvironment } from './voiceRecorder';

/* Модуль захвата — отдельный файл с того же адреса. `no-inline`
   обязателен: маленький файл сборка иначе вшивает как `data:`-адрес, а
   `data:` и `blob:` для скриптов запрещены политикой безопасности (CSP). */
const CAPTURE_MODULE = captureModuleUrl;

/** Браузер: микрофон, AudioWorklet и воркер кодировщика (#843). */
export const browserVoiceEnvironment: IVoiceEnvironment = {
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
    await context.audioWorklet.addModule(CAPTURE_MODULE);
    const node = new AudioWorkletNode(context, 'craneapp-pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    // Узел, не подключённый к выходу, браузер вправе не обрабатывать.
    // Подключаем через нулевую громкость: слышно ничего не будет.
    const silence = context.createGain();
    silence.gain.value = 0;
    node.connect(silence).connect(context.destination);

    return {
      node,
      onSamples(listener) {
        node.port.onmessage = (event: MessageEvent<Float32Array>) => listener(event.data);
      },
    };
  },

  createEncoder: createOpusEncoder,
};
