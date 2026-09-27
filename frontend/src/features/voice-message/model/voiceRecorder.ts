import { pauseActivePlayback } from '@/shared/lib';
import {
  buildWaveform,
  loudnessGainDb,
  MAX_VOICE_DURATION_MS,
  MIN_VOICE_DURATION_MS,
  type IVoiceMeta,
} from '@/shared/lib/voice';
import type { IOpusEncoder } from './opusEncoder';

/*
 * Запись голосового (#843) — без React, чтобы проверяться в node.
 *
 * Главное обещание — микрофон не остаётся включённым. Любой выход (отправка,
 * отмена, ошибка, потеря устройства, отмена во время запроса разрешения)
 * проходит через `release()`: треки останавливаются, контекст звука
 * закрывается, воркер кодировщика завершается.
 *
 * Отмена во время запроса разрешения: у каждого запуска свой номер. Если
 * человек отпустил кнопку, пока браузер спрашивал, пришедший позже поток
 * сразу останавливается, а не начинает писать.
 */

export type TVoiceRecorderStatus = 'idle' | 'requesting' | 'recording' | 'locked' | 'stopping';

export type TVoiceRecorderError =
  /** Человек или браузер запретил доступ к микрофону. */
  | 'permission'
  /** Микрофона нет. */
  | 'no-device'
  /** Микрофон занят другим приложением. */
  | 'busy'
  /** Небезопасный адрес: без HTTPS браузер микрофон не даёт. */
  | 'insecure'
  /** Браузер не умеет нужного: AudioWorklet или WebAssembly. */
  | 'unsupported'
  /** Микрофон пропал посреди записи; записанное сохранено. */
  | 'device-lost'
  /** Отпустили раньше секунды — это касание, а не сообщение. */
  | 'too-short'
  | 'unknown';

export interface IVoiceRecorderState {
  status: TVoiceRecorderStatus;
  elapsedMs: number;
  /** Громкость последних отсчётов, 0…1, — для живой волны. */
  levels: number[];
  error: TVoiceRecorderError | null;
  /** Упёрлись в 15 минут: запись остановлена, её можно отправить. */
  limitReached: boolean;
}

export interface IVoiceRecording {
  blob: Blob;
  meta: IVoiceMeta;
}

/** Всё, что нужно рекордеру от браузера. В тестах — подделки. */
export interface IVoiceEnvironment {
  isSecureContext(): boolean;
  isSupported(): boolean;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(): AudioContext;
  /**
   * Цепочка захвата: `node` — вход (микрофон подключается к нему),
   * отсчёты приходят пачками. `denoised` — в цепочке своё шумоподавление
   * (RNNoise); `dispose` освобождает его память.
   */
  createCapture(context: AudioContext): Promise<{
    node: AudioNode;
    onSamples(listener: (samples: Float32Array) => void): void;
    denoised?: boolean;
    dispose?(): void;
  }>;
  createEncoder(): IOpusEncoder;
  /**
   * Окружение подавляет шум само (RNNoise): браузерное шумоподавление при
   * записи выключается, чтобы голос не обрабатывался дважды и не звучал
   * «из ваты».
   */
  denoises?: boolean;
  /** Прогреть тяжёлое заранее: кодировщик, шумодав. */
  preload?(): void;
}

const LIVE_LEVELS = 40;
const MIME_TYPE = 'audio/ogg; codecs=opus';

const IDLE: IVoiceRecorderState = {
  status: 'idle',
  elapsedMs: 0,
  levels: [],
  error: null,
  limitReached: false,
};

function mediaError(error: unknown): TVoiceRecorderError {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError')
    return 'permission';
  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    name === 'OverconstrainedError'
  )
    return 'no-device';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return 'busy';
  return 'unknown';
}

/** Среднеквадратичный уровень пачки, 0…1. */
function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** Высота столбика волны: уровень, растянутый под речь. */
function levelOf(rms: number): number {
  return Math.min(1, Math.sqrt(rms) * 1.6);
}

export class VoiceRecorder {
  private state: IVoiceRecorderState = IDLE;
  private readonly listeners = new Set<(state: IVoiceRecorderState) => void>();

  /** Номер запуска: запоздавший поток от отменённого запуска не пишет. */
  private session = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioNode | null = null;
  private encoder: IOpusEncoder | null = null;
  private sampleRate = 48000;
  private samples = 0;
  private allLevels: number[] = [];
  /** Сырые уровни — для выравнивания громкости. */
  private allRms: number[] = [];
  private disposeCapture: (() => void) | null = null;
  private capturing = false;
  /**
   * Закрепить, как только запись начнётся: щелчок пришёлся на время, пока
   * браузер выдавал микрофон и грузился кодировщик.
   */
  private lockWhenReady = false;
  /**
   * Звук, пришедший до готовности кодировщика. Кодировщик (WASM) грузится
   * заметное время — без этого буфера пропадало бы первое слово.
   */
  private pending: Float32Array[] = [];
  private encoderReady: Promise<void> | null = null;
  private encoderIsReady = false;

  private readonly env: IVoiceEnvironment;

  constructor(env: IVoiceEnvironment) {
    this.env = env;
  }

  /** Прогреть кодировщик и шумодав, пока человек тянется к кнопке. */
  preload(): void {
    this.env.preload?.();
  }

  getState(): IVoiceRecorderState {
    return this.state;
  }

  subscribe(listener: (state: IVoiceRecorderState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<IVoiceRecorderState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  /**
   * Начать запись. `locked` — сразу закреплённая (клик, клавиатура):
   * держать кнопку не нужно.
   */
  async start(locked = false): Promise<void> {
    if (this.state.status !== 'idle') return;
    const session = ++this.session;
    this.lockWhenReady = false;

    if (!this.env.isSecureContext()) {
      this.set({ ...IDLE, error: 'insecure' });
      return;
    }
    if (!this.env.isSupported()) {
      this.set({ ...IDLE, error: 'unsupported' });
      return;
    }

    this.set({ ...IDLE, status: 'requesting' });
    // Играющее голосовое — на паузу: иначе микрофон запишет динамик.
    pauseActivePlayback();
    let stream: MediaStream;
    try {
      stream = await this.env.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          // Своё шумоподавление (RNNoise) — вместо браузерного, не вместе.
          noiseSuppression: !this.env.denoises,
          autoGainControl: true,
        },
      });
    } catch (error) {
      if (session === this.session) this.set({ ...IDLE, error: mediaError(error) });
      return;
    }

    // Отпустили, пока браузер спрашивал: поток пришёл зря — сразу гасим.
    if (session !== this.session) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;

    try {
      const context = this.env.createAudioContext();
      this.context = context;
      this.sampleRate = context.sampleRate;
      const encoder = this.env.createEncoder();
      this.encoder = encoder;
      // Кодировщик готовится параллельно: запись начинается, как только
      // есть микрофон и узел захвата, а звук до его готовности копится.
      this.encoderReady = encoder.init(context.sampleRate).then(() => {
        if (session !== this.session) return;
        this.encoderIsReady = true;
        this.pending.forEach((chunk) => encoder.encode(chunk));
        this.pending = [];
      });
      // Кодировщик не запустился — записывать некуда: запись прекращается
      // сразу, а не при отправке, и микрофон освобождается.
      this.encoderReady.catch(() => {
        if (session !== this.session) return;
        this.session++;
        this.release();
        this.set({ ...IDLE, error: 'unsupported' });
      });
      const [capture] = await Promise.all([this.env.createCapture(context), context.resume?.()]);
      if (session !== this.session) {
        this.release();
        return;
      }

      this.disposeCapture = capture.dispose ?? null;
      // Своё шумоподавление не поднялось — возвращаем браузерное.
      if (this.env.denoises && !capture.denoised) {
        stream.getAudioTracks().forEach((track) => {
          void track.applyConstraints?.({ noiseSuppression: true }).catch(() => undefined);
        });
      }
      capture.onSamples((chunk) => this.onSamples(session, chunk));
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(capture.node);
      this.capture = capture.node;
      this.capturing = true;

      stream
        .getAudioTracks()
        .forEach((track) => track.addEventListener('ended', () => this.onDeviceLost(session)));
      this.set({ status: locked || this.lockWhenReady ? 'locked' : 'recording' });
    } catch {
      if (session === this.session) {
        this.release();
        this.set({ ...IDLE, error: 'unsupported' });
      }
    }
  }

  /** Закрепить: палец можно отпустить. */
  lock(): void {
    if (this.state.status === 'recording') this.set({ status: 'locked' });
    if (this.state.status === 'requesting') this.lockWhenReady = true;
  }

  /** Отменить: ничего не отправляется, микрофон освобождается. */
  cancel(): void {
    this.session++;
    this.lockWhenReady = false;
    this.release();
    this.set(IDLE);
  }

  /**
   * Закончить и отдать запись. `null` — отправлять нечего: отменено или
   * короче секунды (тогда в состоянии подсказка `too-short`).
   */
  async finish(): Promise<IVoiceRecording | null> {
    const { status } = this.state;
    if (status !== 'recording' && status !== 'locked') {
      // Отпустили, пока браузер спрашивал разрешение: это отмена.
      if (status === 'requesting') this.cancel();
      return null;
    }
    const session = this.session;
    this.stopCapture();
    this.set({ status: 'stopping' });

    const encoder = this.encoder;
    const durationMs = this.durationMs();
    const levels = this.allLevels;
    const gainDb = loudnessGainDb(this.allRms);
    let pages: Uint8Array[];
    try {
      // Сначала кодировщик дописывает накопленное до его готовности.
      await this.encoderReady;
      pages = encoder ? await encoder.finish() : [];
    } catch {
      pages = [];
    }
    if (session !== this.session) return null;
    this.release();

    if (durationMs < MIN_VOICE_DURATION_MS || pages.length === 0) {
      this.set({
        ...IDLE,
        error: pages.length === 0 && durationMs >= MIN_VOICE_DURATION_MS ? 'unknown' : 'too-short',
      });
      return null;
    }

    this.set(IDLE);
    return {
      blob: new Blob(pages as BlobPart[], { type: MIME_TYPE }),
      meta: { durationMs, waveform: buildWaveform(levels), gainDb },
    };
  }

  /** Всё освободить и забыть: при уходе со страницы и размонтировании. */
  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private durationMs(): number {
    return Math.round((this.samples / this.sampleRate) * 1000);
  }

  private onSamples(session: number, chunk: Float32Array): void {
    if (session !== this.session || !this.capturing) return;
    if (this.encoderIsReady) this.encoder?.encode(chunk);
    else this.pending.push(chunk);
    this.samples += chunk.length;
    const rms = rmsOf(chunk);
    this.allRms.push(rms);
    const level = levelOf(rms);
    this.allLevels.push(level);

    const elapsedMs = this.durationMs();
    const levels = [...this.state.levels, level].slice(-LIVE_LEVELS);
    if (elapsedMs >= MAX_VOICE_DURATION_MS) {
      // Предел: пишем не дальше, запись остаётся — её можно отправить.
      this.stopCapture();
      this.set({ status: 'locked', elapsedMs: MAX_VOICE_DURATION_MS, levels, limitReached: true });
      return;
    }
    this.set({ elapsedMs, levels });
  }

  private onDeviceLost(session: number): void {
    if (session !== this.session || !this.capturing) return;
    // Записанное не пропадает: запись останавливается и ждёт отправки.
    this.stopCapture();
    this.set({ status: 'locked', error: 'device-lost' });
  }

  /** Перестать слушать микрофон, не трогая уже закодированное. */
  private stopCapture(): void {
    this.capturing = false;
    try {
      this.source?.disconnect();
    } catch {
      // Узел уже отключён: другого способа узнать это нет.
    }
    this.source = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private release(): void {
    this.stopCapture();
    try {
      this.capture?.disconnect();
    } catch {
      // Узел уже отключён.
    }
    this.capture = null;
    this.disposeCapture?.();
    this.disposeCapture = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.encoder?.close();
    this.encoder = null;
    this.encoderReady = null;
    this.encoderIsReady = false;
    this.pending = [];
    this.samples = 0;
    this.allLevels = [];
    this.allRms = [];
  }
}
