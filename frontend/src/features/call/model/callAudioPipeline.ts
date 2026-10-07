import {
  CEILING,
  createDenoiser,
  createDynamics,
  decibelsToGain,
  LIMITER,
  type IDenoiserNode,
} from '@/shared/lib/audio';
import {
  SPEECH_RMS_FLOOR,
  VOICE_GAIN_MAX_DB,
  VOICE_GAIN_MIN_DB,
  VOICE_TARGET_DBFS,
} from '@/shared/lib/voice';

/**
 * Обработка микрофона в звонке — как в голосовых:
 * - шумоподавление RNNoise вместо браузерного (#947);
 * - ровная громкость (#948): уровень подстраивается к цели голосовых
 *   (−18 дБFS), громкое ужимает компрессор, пики срезает ограничитель.
 *
 * Граф: микрофон → [RNNoise] → вход → усиление → компрессор → ограничитель →
 * `MediaStreamDestination`. Уровень меряется на входе, до усиления. В
 * соединение уходит трек назначения — один на весь звонок: при смене
 * микрофона перецепляется только источник, и `replaceTrack` не нужен.
 * Эхоподавление и автоусиление делает браузер ещё при захвате, до графа.
 *
 * Обработка у отправителя, а не у слушателя: звук собеседника играет
 * простой `<audio>` — у Chrome эхоподавление плохо дружит со звуком через
 * Web Audio.
 *
 * Пока граф поднимается, отправляется сырой трек: соединение не ждёт
 * загрузки WASM. RNNoise не поднялся — граф без него, с браузерным
 * шумоподавлением. Нет Web Audio — сырой трек, как раньше.
 *
 * Контекст звука браузер запускает только после жеста человека. После F5
 * звонок восстанавливается сам, без нажатий, — до первого нажатия идёт
 * сырой трек, потом отправка переключается на обработанный.
 */

/** Как часто подстраивать усиление. */
export const CALL_GAIN_STEP_MS = 100;
/** Вверх — медленно: паузы и тихое не «вытягиваются» рывком. */
const GAIN_RISE_DB_PER_SECOND = 3;
/** Вниз — быстрее: громкое ужимается раньше, чем оглушит. */
const GAIN_FALL_DB_PER_SECOND = 12;
/** Постоянная сглаживания при смене усиления, с: без щелчков. */
const GAIN_SMOOTHING_S = 0.1;

/**
 * Следующее усиление, дБ. `rms` — уровень на входе за последний шаг,
 * `elapsedMs` — сколько прошло с прошлого шага. Тишина (пауза, выключенный
 * микрофон) усиление не меняет.
 */
export function nextCallGainDb(currentDb: number, rms: number, elapsedMs: number): number {
  if (!(rms > SPEECH_RMS_FLOOR)) return currentDb;
  const levelDb = 20 * Math.log10(rms);
  const wanted = Math.min(
    VOICE_GAIN_MAX_DB,
    Math.max(VOICE_GAIN_MIN_DB, VOICE_TARGET_DBFS - levelDb)
  );
  const seconds = Math.max(0, elapsedMs) / 1000;
  if (wanted > currentDb) return Math.min(wanted, currentDb + GAIN_RISE_DB_PER_SECOND * seconds);
  return Math.max(wanted, currentDb - GAIN_FALL_DB_PER_SECOND * seconds);
}

export interface ICallAudioEnvironment {
  /** Можно построить граф: Web Audio и `MediaStreamDestination`. */
  isSupported(): boolean;
  /** Можно поднять RNNoise: AudioWorklet и WASM. */
  canDenoise(): boolean;
  createAudioContext(): AudioContext;
  createDenoiser(context: AudioContext): Promise<IDenoiserNode | null>;
  /** Источник графа из трека микрофона. */
  createSource(context: AudioContext, track: MediaStreamTrack): AudioNode;
  /** Нажатие или клавиша на странице; возвращает отписку. */
  onUserGesture(listener: () => void): () => void;
  /** Повторять каждые `ms`; возвращает остановку. */
  every(ms: number, tick: () => void): () => void;
}

export const browserCallAudioEnvironment: ICallAudioEnvironment = {
  isSupported: () =>
    typeof AudioContext !== 'undefined' && typeof MediaStreamAudioDestinationNode !== 'undefined',

  canDenoise: () => typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined',

  // 48 кГц — частота RNNoise; `interactive` — наименьшая задержка для разговора.
  createAudioContext: () => new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }),

  createDenoiser,

  createSource: (context, track) => context.createMediaStreamSource(new MediaStream([track])),

  onUserGesture(listener) {
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach((type) => window.addEventListener(type, listener, true));
    return () => events.forEach((type) => window.removeEventListener(type, listener, true));
  },

  every(ms, tick) {
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
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

function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}

type TOutputListener = (track: MediaStreamTrack) => void;

export class CallAudioPipeline {
  private readonly env: ICallAudioEnvironment;
  private context: AudioContext | null = null;
  private source: AudioNode | null = null;
  private denoiser: IDenoiserNode | null = null;
  /** Вход цепочки громкости: сюда приходит звук после шумодава (или без него). */
  private input: GainNode | null = null;
  private gain: GainNode | null = null;
  private gainDb = 0;
  private nodes: AudioNode[] = [];
  private processed: MediaStreamTrack | null = null;
  private raw: MediaStreamTrack | null = null;
  private output: MediaStreamTrack | null = null;
  private enabled = true;
  private started = false;
  /** Номер запуска: `stop()` его меняет, и начатая подготовка бросается. */
  private run = 0;
  private stopGestureWait: (() => void) | null = null;
  private stopMeter: (() => void) | null = null;
  private listeners = new Set<TOutputListener>();

  constructor(env: ICallAudioEnvironment = browserCallAudioEnvironment) {
    this.env = env;
  }

  /** Будет ли своё шумоподавление — от этого зависят настройки микрофона. */
  get denoises(): boolean {
    return this.env.isSupported() && this.env.canDenoise();
  }

  /** Трек, который сейчас должен уходить в соединение. */
  get outputTrack(): MediaStreamTrack | null {
    return this.output;
  }

  /** Текущее усиление выравнивания, дБ. */
  get gainDecibels(): number {
    return this.gainDb;
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

    const denoiser = this.env.canDenoise() ? await this.env.createDenoiser(context) : null;
    if (run !== this.run) {
      denoiser?.destroy();
      return raw;
    }
    this.denoiser = denoiser;

    let processed: MediaStreamTrack | null = null;
    try {
      processed = this.buildChain(context);
    } catch (error) {
      console.warn('Обработка звука в звонке недоступна', error);
    }
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
      setBrowserNoiseSuppression(raw, !this.denoiser);
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

  /** Вход → усиление → компрессор → ограничитель → назначение; уровень — на входе. */
  private buildChain(context: AudioContext): MediaStreamTrack | null {
    const input = context.createGain();
    const gain = context.createGain();
    this.gainDb = 0;
    gain.gain.value = 1;
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    const destination = context.createMediaStreamDestination();
    const chain: AudioNode[] = [
      input,
      gain,
      ...createDynamics(context, CEILING),
      ...createDynamics(context, LIMITER),
      destination,
    ];
    chain.reduce((from, to) => from.connect(to));
    input.connect(analyser);
    this.denoiser?.connect(input);
    this.input = input;
    this.gain = gain;
    this.nodes = [...chain, analyser];
    this.startMeter(context, analyser);
    return destination.stream.getAudioTracks()[0] ?? null;
  }

  private startMeter(context: AudioContext, analyser: AnalyserNode): void {
    const samples = new Float32Array(analyser.fftSize);
    this.stopMeter?.();
    this.stopMeter = this.env.every(CALL_GAIN_STEP_MS, () => {
      if (!this.gain) return;
      analyser.getFloatTimeDomainData(samples);
      const next = nextCallGainDb(this.gainDb, rmsOf(samples), CALL_GAIN_STEP_MS);
      if (next === this.gainDb) return;
      this.gainDb = next;
      this.gain.gain.setTargetAtTime(decibelsToGain(next), context.currentTime, GAIN_SMOOTHING_S);
    });
  }

  private fallBack(): MediaStreamTrack {
    const raw = this.raw as MediaStreamTrack;
    setBrowserNoiseSuppression(raw, true);
    this.switchOutput(raw);
    return raw;
  }

  private useProcessed(): void {
    if (!this.processed) return;
    // Без своего шумодава в графе браузерный остаётся.
    setBrowserNoiseSuppression(this.raw, !this.denoiser);
    this.switchOutput(this.processed);
  }

  private connectSource(): void {
    const head = this.denoiser ?? this.input;
    if (!this.context || !head || !this.raw) return;
    try {
      this.source?.disconnect();
    } catch {
      // Уже отцеплен.
    }
    this.source = this.env.createSource(this.context, this.raw);
    this.source.connect(head);
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
    this.stopMeter?.();
    this.stopMeter = null;
    try {
      this.source?.disconnect();
      this.denoiser?.disconnect();
      this.denoiser?.destroy();
      this.nodes.forEach((node) => node.disconnect());
    } catch {
      // Уже освобождены.
    }
    this.processed?.stop();
    this.source = null;
    this.denoiser = null;
    this.input = null;
    this.gain = null;
    this.nodes = [];
    this.processed = null;
    this.closeContext();
  }
}
