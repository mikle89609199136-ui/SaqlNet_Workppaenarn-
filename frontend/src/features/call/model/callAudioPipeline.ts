import { createDenoiser, type IDenoiserNode } from '@/shared/lib/audio';

/**
 * Обработка микрофона в звонке (#947) — как в голосовых: шумоподавление
 * RNNoise вместо браузерного.
 *
 * Граф: микрофон → RNNoise → `MediaStreamDestination`. В соединение уходит
 * трек назначения — один на весь звонок: при смене микрофона перецепляется
 * только источник, и `replaceTrack` не нужен. Эхоподавление и автоусиление
 * делает браузер ещё при захвате, до графа.
 *
 * Пока шумодав поднимается, отправляется сырой трек: соединение не ждёт
 * загрузки WASM. Не поднялся (нет Web Audio или WASM, частота не 48 кГц,
 * модуль не загрузился) — сырой трек остаётся, с браузерным
 * шумоподавлением: звонок звучит как раньше, а не молчит.
 *
 * Контекст звука браузер запускает только после жеста человека. После F5
 * звонок восстанавливается сам, без нажатий, — до первого нажатия идёт
 * сырой трек, потом отправка переключается на обработанный.
 */

export interface ICallAudioEnvironment {
  /** Есть всё нужное: Web Audio, AudioWorklet, WASM. */
  isSupported(): boolean;
  createAudioContext(): AudioContext;
  createDenoiser(context: AudioContext): Promise<IDenoiserNode | null>;
  /** Источник графа из трека микрофона. */
  createSource(context: AudioContext, track: MediaStreamTrack): AudioNode;
  /** Нажатие или клавиша на странице; возвращает отписку. */
  onUserGesture(listener: () => void): () => void;
}

export const browserCallAudioEnvironment: ICallAudioEnvironment = {
  isSupported: () =>
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof MediaStreamAudioDestinationNode !== 'undefined' &&
    typeof WebAssembly !== 'undefined',

  // 48 кГц — частота RNNoise; `interactive` — наименьшая задержка для разговора.
  createAudioContext: () => new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }),

  createDenoiser,

  createSource: (context, track) => context.createMediaStreamSource(new MediaStream([track])),

  onUserGesture(listener) {
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach((type) => window.addEventListener(type, listener, true));
    return () => events.forEach((type) => window.removeEventListener(type, listener, true));
  },
};

/** Настройки микрофона в звонке — как в голосовых. */
export function callAudioConstraints(denoises: boolean): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: true,
    // Своё шумоподавление — вместо браузерного, не вместе.
    noiseSuppression: !denoises,
    autoGainControl: true,
  };
}

function setBrowserNoiseSuppression(track: MediaStreamTrack | null, enabled: boolean): void {
  void track?.applyConstraints?.({ noiseSuppression: enabled }).catch(() => undefined);
}

type TOutputListener = (track: MediaStreamTrack) => void;

export class CallAudioPipeline {
  private context: AudioContext | null = null;
  private source: AudioNode | null = null;
  private denoiser: IDenoiserNode | null = null;
  private processed: MediaStreamTrack | null = null;
  private raw: MediaStreamTrack | null = null;
  private output: MediaStreamTrack | null = null;
  private enabled = true;
  private started = false;
  /** Номер запуска: `stop()` его меняет, и начатая подготовка бросается. */
  private run = 0;
  private stopGestureWait: (() => void) | null = null;
  private listeners = new Set<TOutputListener>();

  private readonly env: ICallAudioEnvironment;

  constructor(env: ICallAudioEnvironment = browserCallAudioEnvironment) {
    this.env = env;
  }

  /** Будет ли своё шумоподавление — от этого зависят настройки микрофона. */
  get denoises(): boolean {
    return this.env.isSupported();
  }

  /** Трек, который сейчас должен уходить в соединение. */
  get outputTrack(): MediaStreamTrack | null {
    return this.output;
  }

  /** Отправка переключилась на другой трек — его надо подставить в соединение. */
  onOutputChange(listener: TOutputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Поднять обработку для микрофона. Пока она поднимается, отправляется
   * сырой трек; готово — отправка переключается через `onOutputChange`.
   * Возвращает трек, который отправляется по итогу.
   */
  async start(raw: MediaStreamTrack): Promise<MediaStreamTrack> {
    if (this.started) {
      this.setSource(raw);
      return this.output ?? raw;
    }
    this.started = true;
    const run = this.run;
    this.raw = raw;
    this.output = raw;
    if (!this.env.isSupported()) return this.fallBack();

    let context: AudioContext;
    try {
      context = this.env.createAudioContext();
    } catch (error) {
      console.warn('Обработка звука в звонке недоступна', error);
      return this.fallBack();
    }
    this.context = context;

    const denoiser = await this.env.createDenoiser(context);
    if (run !== this.run) {
      denoiser?.destroy();
      return raw;
    }
    if (!denoiser) {
      this.closeContext();
      return this.fallBack();
    }
    this.denoiser = denoiser;

    const destination = context.createMediaStreamDestination();
    denoiser.connect(destination);
    const processed = destination.stream.getAudioTracks()[0] ?? null;
    if (!processed) {
      this.release();
      return this.fallBack();
    }
    processed.enabled = this.enabled;
    this.processed = processed;
    this.connectSource();

    await context.resume().catch(() => undefined);
    if (run !== this.run) return raw;

    if (context.state === 'running') {
      this.useProcessed();
    } else {
      // Контекст не запустился без жеста: пока — сырой трек с шумодавом браузера.
      setBrowserNoiseSuppression(this.raw, true);
      this.waitForGesture();
    }
    return this.output ?? raw;
  }

  /** Сменился микрофон: перецепить источник. */
  setSource(raw: MediaStreamTrack): void {
    this.raw = raw;
    if (!this.started) return;

    if (this.processed && this.output === this.processed) {
      // Обработка работает — отправляемый трек тот же.
      setBrowserNoiseSuppression(raw, false);
      this.connectSource();
      return;
    }

    // Отправляется сырой трек (обработка не поднялась, поднимается или ждёт жеста).
    if (this.processed) this.connectSource();
    if (!this.processed || this.stopGestureWait) setBrowserNoiseSuppression(raw, true);
    this.switchOutput(raw);
  }

  /** Выключение микрофона: гасится и отправляемый трек. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.processed) this.processed.enabled = enabled;
  }

  /**
   * Остановить: освободить узлы и контекст. Подписки на `onOutputChange`
   * остаются, `start` поднимет обработку заново — так переживается двойное
   * монтирование эффектов в StrictMode.
   */
  stop(): void {
    this.run++;
    this.started = false;
    this.release();
    this.raw = null;
    this.output = null;
  }

  private fallBack(): MediaStreamTrack {
    const raw = this.raw as MediaStreamTrack;
    setBrowserNoiseSuppression(raw, true);
    this.switchOutput(raw);
    return raw;
  }

  private useProcessed(): void {
    if (!this.processed) return;
    setBrowserNoiseSuppression(this.raw, false);
    this.switchOutput(this.processed);
  }

  private connectSource(): void {
    if (!this.context || !this.denoiser || !this.raw) return;
    try {
      this.source?.disconnect();
    } catch {
      // Уже отцеплен.
    }
    this.source = this.env.createSource(this.context, this.raw);
    this.source.connect(this.denoiser);
  }

  private waitForGesture(): void {
    this.stopGestureWait?.();
    const run = this.run;
    this.stopGestureWait = this.env.onUserGesture(() => {
      const context = this.context;
      if (!context || run !== this.run) return;
      void context
        .resume()
        .catch(() => undefined)
        .then(() => {
          if (run !== this.run || context.state !== 'running' || !this.stopGestureWait) return;
          this.stopGestureWait();
          this.stopGestureWait = null;
          this.useProcessed();
        });
    });
  }

  private switchOutput(track: MediaStreamTrack): void {
    if (this.output === track) return;
    this.output = track;
    this.listeners.forEach((listener) => listener(track));
  }

  private closeContext(): void {
    const context = this.context;
    this.context = null;
    void context?.close().catch(() => undefined);
  }

  private release(): void {
    this.stopGestureWait?.();
    this.stopGestureWait = null;
    try {
      this.source?.disconnect();
      this.denoiser?.disconnect();
      this.denoiser?.destroy();
    } catch {
      // Уже освобождены.
    }
    this.processed?.stop();
    this.source = null;
    this.denoiser = null;
    this.processed = null;
    this.closeContext();
  }
}
