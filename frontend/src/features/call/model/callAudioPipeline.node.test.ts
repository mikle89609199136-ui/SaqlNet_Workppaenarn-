import { describe, expect, it, vi } from 'vitest';
import {
  callAudioConstraints,
  CallAudioPipeline,
  nextCallGainDb,
  type ICallAudioEnvironment,
} from './callAudioPipeline';

const rmsAt = (dbfs: number) => 10 ** (dbfs / 20);

describe('nextCallGainDb', () => {
  it('тишина и пауза усиление не меняют', () => {
    expect(nextCallGainDb(5, 0, 100)).toBe(5);
    expect(nextCallGainDb(5, rmsAt(-45), 100)).toBe(5);
    expect(nextCallGainDb(5, Number.NaN, 100)).toBe(5);
  });

  it('тихая речь — растёт не быстрее 3 дБ/с', () => {
    expect(nextCallGainDb(0, rmsAt(-30), 100)).toBeCloseTo(0.3, 10);
    expect(nextCallGainDb(0, rmsAt(-30), 1000)).toBeCloseTo(3, 10);
    // Цель +12 дБ: дальше неё не растёт.
    expect(nextCallGainDb(11.9, rmsAt(-30), 1000)).toBeCloseTo(12, 10);
  });

  it('громкая речь — падает до 12 дБ/с', () => {
    expect(nextCallGainDb(0, rmsAt(-6), 100)).toBeCloseTo(-1.2, 10);
    expect(nextCallGainDb(0, rmsAt(-6), 1000)).toBeCloseTo(-12, 10);
  });

  it('речь на цели (−18 дБFS) — около нуля', () => {
    expect(nextCallGainDb(0, rmsAt(-18), 100)).toBeCloseTo(0, 10);
    expect(nextCallGainDb(0.2, rmsAt(-18), 100)).toBeCloseTo(0, 10);
  });

  it('пределы как в голосовых: не выше +18 и не ниже −12 дБ', () => {
    expect(nextCallGainDb(17.9, rmsAt(-39), 10_000)).toBe(18);
    expect(nextCallGainDb(-11.9, rmsAt(-1), 10_000)).toBe(-12);
  });
});

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

class FakeParam {
  value = 0;
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  /** Уровень, который «слышит» замер: постоянный сигнал с этим RMS. */
  level = 0;
  getFloatTimeDomainData(samples: Float32Array) {
    samples.fill(this.level);
  }
}

class FakeContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  /** Запустится ли контекст без жеста. */
  allowResume = true;
  currentTime = 0;
  processed = new FakeTrack('processed');
  destination = Object.assign(new FakeNode('destination'), {
    stream: { getAudioTracks: () => [this.processed] },
  });
  gains: FakeGain[] = [];
  analyser = new FakeAnalyser('analyser');
  resume = vi.fn(async () => {
    if (this.allowResume) this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createMediaStreamDestination = () => this.destination;
  createGain = () => {
    const node = new FakeGain(`gain${this.gains.length}`);
    this.gains.push(node);
    return node;
  };
  createDynamicsCompressor = () => new FakeCompressor('compressor');
  createAnalyser = () => this.analyser;
}

interface ISetup {
  supported?: boolean;
  canDenoise?: boolean;
  denoiser?: FakeNode | null;
  allowResume?: boolean;
}

function setup({
  supported = true,
  canDenoise = true,
  denoiser = new FakeNode('rnnoise'),
  allowResume = true,
}: ISetup = {}) {
  const context = new FakeContext();
  context.allowResume = allowResume;
  let gesture: (() => void) | null = null;
  const stopGesture = vi.fn(() => {
    gesture = null;
  });
  let tick: (() => void) | null = null;
  const stopMeter = vi.fn(() => {
    tick = null;
  });
  let resolveDenoiser: (node: FakeNode | null) => void = () => undefined;
  const denoiserReady = new Promise<FakeNode | null>((resolve) => {
    resolveDenoiser = resolve;
  });
  const env = {
    isSupported: () => supported,
    canDenoise: () => canDenoise,
    every: vi.fn((_ms: number, onTick: () => void) => {
      tick = onTick;
      return stopMeter;
    }),
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
    stopMeter,
    /** Шумодав загрузился (или нет) — как WASM приходит из сети. */
    finishDenoiser: (node: FakeNode | null = denoiser) => resolveDenoiser(node),
    gesture: () => gesture?.(),
    hasGestureListener: () => gesture !== null,
    /** Шаг замера уровня. */
    tick: () => tick?.(),
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
  });

  it('цепочка: микрофон → RNNoise → вход → усиление → компрессор → ограничитель → отправка, замер на входе', async () => {
    const s = setup();
    const started = s.pipeline.start(asTrack(new FakeTrack('raw')));
    s.finishDenoiser();
    await started;

    const chain: string[] = [];
    let node = lastSource(s.env) as FakeNode | undefined;
    while (node) {
      chain.push(node.label);
      node = node.connections.find((to) => to !== s.context.analyser) as FakeNode | undefined;
    }
    // Компрессор и ограничитель — каждый с вычетом своей прибавки (gain).
    expect(chain).toEqual([
      'source:raw',
      'rnnoise',
      'gain0',
      'gain1',
      'compressor',
      'gain2',
      'compressor',
      'gain3',
      'destination',
    ]);
    const input = s.context.gains[0];
    expect(input.connections).toContain(s.context.analyser);
  });

  it('браузер без Web Audio — сырой трек с браузерным шумодавом, контекст не создаётся', async () => {
    const s = setup({ supported: false });
    const raw = new FakeTrack('raw');

    const output = await s.pipeline.start(asTrack(raw));

    expect(output).toBe(raw);
    expect(s.pipeline.denoises).toBe(false);
    expect(raw.applyConstraints).toHaveBeenCalledWith({ noiseSuppression: true });
    expect(s.env.createAudioContext).not.toHaveBeenCalled();
    expect(s.outputs).toEqual([]);
  });

  it('шумодав не поднялся — громкость выравнивается всё равно, шумодав браузерный (#948)', async () => {
    const s = setup();
    const raw = new FakeTrack('raw');

    const started = s.pipeline.start(asTrack(raw));
    s.finishDenoiser(null);
    const output = await started;

    expect(output).toBe(s.context.processed);
    expect(s.outputs).toEqual(['processed']);
    expect(raw.applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: true });
    expect(s.context.close).not.toHaveBeenCalled();
    expect(lastSource(s.env).connections[0]).toBe(s.context.gains[0]);
  });

  it('нет AudioWorklet или WASM — шумодав даже не грузится, громкость выравнивается', async () => {
    const s = setup({ canDenoise: false });
    const raw = new FakeTrack('raw');

    const output = await s.pipeline.start(asTrack(raw));

    expect(s.pipeline.denoises).toBe(false);
    expect(s.env.createDenoiser).not.toHaveBeenCalled();
    expect(output).toBe(s.context.processed);
    expect(raw.applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: true });
  });

  it('тихая речь — усиление растёт на 0,3 дБ за шаг, громкая — падает на 1,2 дБ, тишина его не трогает', async () => {
    const s = setup();
    const started = s.pipeline.start(asTrack(new FakeTrack('raw')));
    s.finishDenoiser();
    await started;
    const gain = s.context.gains[1].gain;

    s.context.analyser.level = 0.001; // −60 дБFS: пауза
    s.tick();
    expect(s.pipeline.gainDecibels).toBe(0);
    expect(gain.setTargetAtTime).not.toHaveBeenCalled();

    s.context.analyser.level = 10 ** (-35 / 20); // −35 дБFS: тихо
    s.tick();
    s.tick();
    expect(s.pipeline.gainDecibels).toBeCloseTo(0.6, 5);
    expect(gain.value).toBeCloseTo(10 ** (0.6 / 20), 5);

    s.context.analyser.level = 10 ** (-6 / 20); // −6 дБFS: громко
    s.tick();
    expect(s.pipeline.gainDecibels).toBeCloseTo(0.6 - 1.2, 5);
  });

  it('остановка снимает замер уровня', async () => {
    const s = setup();
    const started = s.pipeline.start(asTrack(new FakeTrack('raw')));
    s.finishDenoiser();
    await started;

    s.pipeline.stop();

    expect(s.stopMeter).toHaveBeenCalled();
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
