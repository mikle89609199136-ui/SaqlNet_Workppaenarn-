import encoderWorkerUrl from 'opus-recorder/dist/encoderWorker.min.js?url';

/**
 * Кодировщик Ogg/Opus в воркере (#843).
 *
 * Воркер — готовая сборка libopus из `opus-recorder` (MIT). Класс
 * `Recorder` из того же пакета не используется: он сам берёт микрофон, а
 * нам нужно управлять им самим — отменять запрос разрешения, освобождать
 * устройство при любом выходе. Поэтому общаемся с воркером напрямую, по
 * его протоколу: `init` → `ready`, `encode` → страницы, `done` → остаток и
 * `done`.
 *
 * Файл воркера отдаётся с того же адреса, что и приложение: `blob:` для
 * воркеров запрещён политикой безопасности (CSP).
 */

export interface IOpusEncoder {
  /** Ждёт готовности кодировщика (загрузка WASM). */
  init(inputSampleRate: number): Promise<void>;
  encode(samples: Float32Array): void;
  /** Дописывает остаток и отдаёт все страницы Ogg. */
  finish(): Promise<Uint8Array[]>;
  /** Немедленно прекращает работу, результат теряется. */
  close(): void;
}

interface IWorkerMessage {
  message?: 'ready' | 'page' | 'done' | 'flushed';
  page?: Uint8Array;
}

/** Голос: моно, 32 кбит/с, профиль VoIP — как в мессенджерах. */
const ENCODER_OPTIONS = {
  numberOfChannels: 1,
  encoderSampleRate: 48000,
  encoderApplication: 2048,
  encoderBitRate: 32000,
  encoderFrameSize: 20,
  streamPages: true,
};

export function createOpusEncoder(): IOpusEncoder {
  const worker = new Worker(encoderWorkerUrl);
  const pages: Uint8Array[] = [];
  let closed = false;
  let onReady: (() => void) | null = null;
  let onDone: (() => void) | null = null;
  let onFail: ((error: Error) => void) | null = null;

  worker.addEventListener('message', (event: MessageEvent<IWorkerMessage>) => {
    const data = event.data;
    if (data?.message === 'ready') onReady?.();
    if (data?.message === 'page' && data.page) pages.push(data.page);
    if (data?.message === 'done') onDone?.();
  });
  worker.addEventListener('error', () =>
    onFail?.(new Error('Кодировщик голосового не запустился'))
  );

  return {
    init(inputSampleRate) {
      return new Promise((resolve, reject) => {
        onReady = () => {
          // Заголовки Ogg (OpusHead, OpusTags) воркер отдаёт только по
          // отдельной просьбе. Без них файл начинается сразу со звука, и
          // проигрыватель его не открывает. Сообщения воркер разбирает по
          // порядку, так что заголовки лягут в файл первыми.
          worker.postMessage({ command: 'getHeaderPages' });
          resolve();
        };
        onFail = reject;
        worker.postMessage({
          command: 'init',
          originalSampleRate: inputSampleRate,
          ...ENCODER_OPTIONS,
        });
      });
    },
    encode(samples) {
      if (!closed) worker.postMessage({ command: 'encode', buffers: [samples] });
    },
    finish() {
      return new Promise((resolve, reject) => {
        if (closed) {
          resolve(pages);
          return;
        }
        onDone = () => resolve(pages);
        onFail = reject;
        worker.postMessage({ command: 'done' });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      worker.terminate();
    },
  };
}
