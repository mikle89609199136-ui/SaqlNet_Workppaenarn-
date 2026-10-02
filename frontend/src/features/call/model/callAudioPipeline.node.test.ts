import { describe, expect, it, vi } from 'vitest';
import {
  callAudioConstraints,
  CallAudioPipeline,
  type ICallAudioEnvironment,
} from './callAudioPipeline';

class FakeTrack {
  kind = 'audio';
  enabled = true;
  stopped = false;
  applyConstraints = vi.fn(async () => undefined);
  readonly label: string;
  constructor(label: string) {
    this.label = label;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeNode {
  connections: unknown[] = [];
  disconnect = vi.fn();
  destroy = vi.fn();
  readonly label: string;
  constructor(label: string) {
    this.label = label;
  }
  connect<T>(to: T): T {
    this.connections.push(to);
    return to;
  }
}

class FakeContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  /** Запустится ли контекст без жеста. */
  allowResume = true;
  processed = new FakeTrack('processed');
  destination = Object.assign(new FakeNode('destination'), {
    stream: { getAudioTracks: () => [this.processed] },
  });
  resume = vi.fn(async () => {
    if (this.allowResume) this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createMediaStreamDestination = () => this.destination;
}

interface ISetup {
  supported?: boolean;
  denoiser?: FakeNode | null;
  allowResume?: boolean;
}

function setup({
  supported = true,
  denoiser = new FakeNode('rnnoise'),
  allowResume = true,
}: ISetup = {}) {
  const context = new FakeContext();
  context.allowResume = allowResume;
  let gesture: (() => void) | null = null;
  const stopGesture = vi.fn(() => {
    gesture = null;
  });
  let resolveDenoiser: (node: FakeNode | null) => void = () => undefined;
  const denoiserReady = new Promise<FakeNode | null>((resolve) => {
    resolveDenoiser = resolve;
  });
  const env = {
    isSupported: () => supported,
    createAudioContext: vi.fn(() => context as unknown as AudioContext),
    createDenoiser: vi.fn(() => denoiserReady),
    createSource: vi.fn((_context: AudioContext, track: MediaStreamTrack) => {
      return new FakeNode(
        `source:${(track as unknown as FakeTrack).label}`
      ) as unknown as AudioNode;
    }),
    onUserGesture: vi.fn((listener: () => void) => {
      gesture = listener;
      return stopGesture;
    }),
  };

  const pipeline = new CallAudioPipeline(env as unknown as ICallAudioEnvironment);
  const outputs: string[] = [];
  pipeline.onOutputChange((track) => outputs.push((track as unknown as FakeTrack).label));

  return {
    pipeline,
    env,
    context,
    outputs,
    stopGesture,
    /** Шумодав загрузился (или нет) — как WASM приходит из сети. */
    finishDenoiser: (node: FakeNode | null = denoiser) => resolveDenoiser(node),
    gesture: () => gesture?.(),
    hasGestureListener: () => gesture !== null,
  };
}

const asTrack = (track: FakeTrack) => track as unknown as MediaStreamTrack;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastSource = (env: ReturnType<typeof setup>['env']) =>
  env.createSource.mock.results.at(-1)?.value as unknown as FakeNode;

describe('callAudioConstraints', () => {
  it('со своим шумодавом браузерный выключен, остальное как в голосовых', () => {
    expect(callAudioConstraints(true)).toEqual({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(callAudioConstraints(false).noiseSuppression).toBe(true);
  });
});

describe('CallAudioPipeline', () => {
  it('шумодав поднялся — в отправке обработанный трек, браузерный шумодав выключен', async () => {
    const s = setup();
    const raw = new FakeTrack('raw');

    const started = s.pipeline.start(asTrack(raw));
    expect(s.pipeline.outputTrack).toBe(raw);
    s.finishDenoiser();
    const output = await started;

    expect(output).toBe(s.context.processed);
    expect(s.outputs).toEqual(['processed']);
    expect(raw.applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: false });
    const source = lastSource(s.env);
    expect(source.label).toBe('source:raw');
    expect((source.connections[0] as FakeNode).label).toBe('rnnoise');
    expect((source.connections[0] as FakeNode).connections).toContain(s.context.destination);
  });

  it('браузер без Web Audio или WASM — сырой трек с браузерным шумодавом, контекст не создаётся', async () => {
    const s = setup({ supported: false });
    const raw = new FakeTrack('raw');

    const output = await s.pipeline.start(asTrack(raw));

    expect(output).toBe(raw);
    expect(s.pipeline.denoises).toBe(false);
    expect(raw.applyConstraints).toHaveBeenCalledWith({ noiseSuppression: true });
    expect(s.env.createAudioContext).not.toHaveBeenCalled();
    expect(s.outputs).toEqual([]);
  });

  it('шумодав не поднялся — сырой трек с браузерным шумодавом, контекст закрыт', async () => {
    const s = setup();
    const raw = new FakeTrack('raw');

    const started = s.pipeline.start(asTrack(raw));
    s.finishDenoiser(null);
    const output = await started;

    expect(output).toBe(raw);
    expect(raw.applyConstraints).toHaveBeenCalledWith({ noiseSuppression: true });
    expect(s.context.close).toHaveBeenCalled();
    expect(s.outputs).toEqual([]);
  });

  it('контекст не запустился без жеста (F5) — сырой трек, после нажатия — обработанный', async () => {
    const s = setup({ allowResume: false });
    const raw = new FakeTrack('raw');

    const started = s.pipeline.start(asTrack(raw));
    s.finishDenoiser();
    const output = await started;

    expect(output).toBe(raw);
    expect(raw.applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: true });
    expect(s.hasGestureListener()).toBe(true);

    s.context.allowResume = true;
    s.gesture();
    await flush();

    expect(s.outputs).toEqual(['processed']);
    expect(s.pipeline.outputTrack).toBe(s.context.processed);
    expect(raw.applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: false });
    expect(s.stopGesture).toHaveBeenCalled();
  });

  it('нажатие не запустило контекст — ждём следующего, отправка не меняется', async () => {
    const s = setup({ allowResume: false });
    const started = s.pipeline.start(asTrack(new FakeTrack('raw')));
    s.finishDenoiser();
    await started;

    s.gesture();
    await flush();

    expect(s.outputs).toEqual([]);
    expect(s.hasGestureListener()).toBe(true);
  });

  it('смена микрофона при работающей обработке — источник перецеплен, отправляемый трек тот же', async () => {
    const s = setup();
    const started = s.pipeline.start(asTrack(new FakeTrack('raw')));
    s.finishDenoiser();
    await started;
    const oldSource = lastSource(s.env);
    const next = new FakeTrack('next');

    s.pipeline.setSource(asTrack(next));

    expect(oldSource.disconnect).toHaveBeenCalled();
    expect(lastSource(s.env).label).toBe('source:next');
    expect(s.outputs).toEqual(['processed']);
    expect(s.pipeline.outputTrack).toBe(s.context.processed);
    expect(next.applyConstraints).toHaveBeenCalledWith({ noiseSuppression: false });
  });

  it('смена микрофона без обработки — в отправку новый сырой трек с браузерным шумодавом', async () => {
    const s = setup({ supported: false });
    await s.pipeline.start(asTrack(new FakeTrack('raw')));
    const next = new FakeTrack('next');

    s.pipeline.setSource(asTrack(next));

    expect(s.outputs).toEqual(['next']);
    expect(next.applyConstraints).toHaveBeenCalledWith({ noiseSuppression: true });
  });

  it('смена микрофона, пока шумодав грузится, — сначала новый сырой трек, потом обработка от него', async () => {
    const s = setup();
    const started = s.pipeline.start(asTrack(new FakeTrack('raw')));
    const next = new FakeTrack('next');

    s.pipeline.setSource(asTrack(next));
    expect(s.outputs).toEqual(['next']);

    s.finishDenoiser();
    await started;

    expect(lastSource(s.env).label).toBe('source:next');
    expect(s.outputs).toEqual(['next', 'processed']);
    expect(next.applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: false });
  });

  it('выключение микрофона гасит отправляемый трек, включение — зажигает', async () => {
    const s = setup();
    s.pipeline.setEnabled(false);
    const started = s.pipeline.start(asTrack(new FakeTrack('raw')));
    s.finishDenoiser();
    await started;

    expect(s.context.processed.enabled).toBe(false);
    s.pipeline.setEnabled(true);
    expect(s.context.processed.enabled).toBe(true);
    s.pipeline.setEnabled(false);
    expect(s.context.processed.enabled).toBe(false);
  });

  it('отбой — узлы отцеплены, шумодав и обработанный трек освобождены, контекст закрыт', async () => {
    const s = setup({ allowResume: false });
    const started = s.pipeline.start(asTrack(new FakeTrack('raw')));
    s.finishDenoiser();
    await started;
    const source = lastSource(s.env);
    const denoiser = source.connections[0] as FakeNode;

    s.pipeline.stop();

    expect(source.disconnect).toHaveBeenCalled();
    expect(denoiser.disconnect).toHaveBeenCalled();
    expect(denoiser.destroy).toHaveBeenCalled();
    expect(s.context.processed.stopped).toBe(true);
    expect(s.context.close).toHaveBeenCalled();
    expect(s.stopGesture).toHaveBeenCalled();
  });

  it('отбой, пока шумодав грузится, — пришедший шумодав сразу освобождён, отправка не меняется', async () => {
    const s = setup();
    const raw = new FakeTrack('raw');
    const denoiser = new FakeNode('late');
    const started = s.pipeline.start(asTrack(raw));

    s.pipeline.stop();
    s.finishDenoiser(denoiser);
    await started;

    expect(denoiser.destroy).toHaveBeenCalled();
    expect(s.context.close).toHaveBeenCalled();
    expect(s.env.createSource).not.toHaveBeenCalled();
    expect(s.outputs).toEqual([]);
  });

  it('после остановки поднимается заново — двойное монтирование эффектов в StrictMode', async () => {
    const s = setup();
    const raw = new FakeTrack('raw');
    const first = s.pipeline.start(asTrack(raw));
    s.pipeline.stop();
    const second = s.pipeline.start(asTrack(raw));
    s.finishDenoiser();
    await Promise.all([first, second]);

    expect(s.env.createAudioContext).toHaveBeenCalledTimes(2);
    expect(s.pipeline.outputTrack).toBe(s.context.processed);
    expect(s.outputs).toEqual(['processed']);
  });

  it('повторный запуск с тем же потоком не создаёт второй контекст', async () => {
    const s = setup();
    const raw = new FakeTrack('raw');
    const started = s.pipeline.start(asTrack(raw));
    s.finishDenoiser();
    await started;

    await s.pipeline.start(asTrack(raw));

    expect(s.env.createAudioContext).toHaveBeenCalledTimes(1);
    expect(s.pipeline.outputTrack).toBe(s.context.processed);
  });
});
