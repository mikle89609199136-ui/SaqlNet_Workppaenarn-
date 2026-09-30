import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('opus-recorder/dist/encoderWorker.min.js?url', () => ({ default: '/encoder.js' }));

/** Воркер-подделка: отвечает, как настоящий кодировщик opus-recorder. */
class FakeEncoderWorker extends EventTarget {
  static last: FakeEncoderWorker;
  commands: string[] = [];
  terminated = false;
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    FakeEncoderWorker.last = this;
  }

  private reply(data: object) {
    queueMicrotask(() => this.dispatchEvent(Object.assign(new Event('message'), { data })));
  }

  postMessage(message: { command: string }) {
    this.commands.push(message.command);
    const page = (tag: string) => ({ message: 'page', page: new TextEncoder().encode(tag) });
    if (message.command === 'init') this.reply({ message: 'ready' });
    if (message.command === 'getHeaderPages') {
      this.reply(page('OpusHead'));
      this.reply(page('OpusTags'));
    }
    if (message.command === 'encode') this.reply(page('audio'));
    if (message.command === 'done') {
      this.reply(page('last'));
      this.reply({ message: 'done' });
    }
  }

  terminate() {
    this.terminated = true;
  }
}

afterEach(() => vi.unstubAllGlobals());

/* Протокол воркера кодировщика (#843). Живой тест поймал: без
   getHeaderPages файл начинался со звука, и его никто не открывал. */
describe('кодировщик Ogg/Opus', () => {
  it('просит заголовки сразу после готовности — они первые в файле', async () => {
    vi.stubGlobal('Worker', FakeEncoderWorker);
    const { createOpusEncoder } = await import('./opusEncoder');
    const encoder = createOpusEncoder();

    await encoder.init(48000);
    encoder.encode(new Float32Array(10));
    const pages = await encoder.finish();

    const worker = FakeEncoderWorker.last;
    expect(worker.url).toBe('/encoder.js');
    expect(worker.commands).toEqual(['init', 'getHeaderPages', 'encode', 'done']);
    expect(pages.map((page) => new TextDecoder().decode(page))).toEqual([
      'OpusHead',
      'OpusTags',
      'audio',
      'last',
    ]);
  });

  it('close завершает воркер, дальнейшее кодирование молча игнорируется', async () => {
    vi.stubGlobal('Worker', FakeEncoderWorker);
    const { createOpusEncoder } = await import('./opusEncoder');
    const encoder = createOpusEncoder();
    await encoder.init(48000);

    encoder.close();
    encoder.encode(new Float32Array(10));

    expect(FakeEncoderWorker.last.terminated).toBe(true);
    expect(FakeEncoderWorker.last.commands).not.toContain('encode');
  });
});
