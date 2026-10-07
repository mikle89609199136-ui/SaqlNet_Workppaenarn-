import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressorMakeupDb } from '../audio/dynamics';
import {
  applyPlaybackGain,
  releasePlaybackGain,
  resetPlaybackGainContext,
  safePlaybackGainDb,
  setVoicePlaybackLevel,
} from './playbackGain';

type FakeNode = {
  disconnect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
} & Record<string, unknown>;

const param = () => ({ value: 0 });

let contexts: FakeContext[] = [];

class FakeContext {
  destination = { connect: vi.fn(), disconnect: vi.fn() };
  resume = vi.fn(async () => undefined);
  nodes: FakeNode[] = [];
  gains: { gain: { value: number } }[] = [];
  compressors: Record<string, { value: number }>[] = [];
  constructor() {
    contexts.push(this);
  }
  private node(extra: Record<string, unknown> = {}): FakeNode {
    const self: FakeNode = {
      disconnect: vi.fn(),
      connect: vi.fn((next: unknown) => next),
      ...extra,
    };
    this.nodes.push(self);
    return self;
  }
  createMediaElementSource = vi.fn(() => this.node());
  createGain = vi.fn(() => {
    const gain = this.node({ gain: param() }) as unknown as { gain: { value: number } };
    this.gains.push(gain);
    return gain;
  });
  createDynamicsCompressor = vi.fn(() => {
    const settings = {
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
    };
    this.compressors.push(settings);
    return this.node(settings);
  });
}

const media = () => ({}) as HTMLMediaElement;

const outputOf = (context: FakeContext) =>
  context.nodes.find((node) =>
    node.connect.mock.calls.some(([target]) => target === context.destination)
  )! as FakeNode & { gain: { value: number } };

beforeEach(() => {
  contexts = [];
  resetPlaybackGainContext();
  vi.stubGlobal('AudioContext', FakeContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* Громкость голосового при воспроизведении (#843). */
describe('громкость голосового при воспроизведении', () => {
  it('поправка из дБ в разы, звук — через компрессор и ограничитель к выходу', () => {
    applyPlaybackGain(media(), 6);

    const [context] = contexts;
    expect(context.gains[0].gain.value).toBeCloseTo(1.995, 3);
    expect(context.compressors).toHaveLength(2);
    expect(context.compressors[1].threshold.value).toBe(-3);
    // Цепочка замкнута до выхода.
    const last = context.nodes[context.nodes.length - 1];
    expect(last.connect).toHaveBeenCalledWith(context.destination);
    expect(context.resume).toHaveBeenCalled();
  });

  it('потолок и без поправки: старое или поддельное голосовое тоже ограничено', () => {
    applyPlaybackGain(media(), undefined);

    expect(contexts[0].compressors).toHaveLength(2);
    expect(contexts[0].gains[0].gain.value).toBe(1);
  });

  it('чужой поправке не доверяем: обрезается до −12…+18, мусор — ноль', () => {
    expect(safePlaybackGainDb(60)).toBe(18);
    expect(safePlaybackGainDb(-60)).toBe(-12);
    expect(safePlaybackGainDb(Number.NaN)).toBe(0);
    expect(safePlaybackGainDb(undefined)).toBe(0);

    applyPlaybackGain(media(), 60);
    expect(contexts[0].gains[0].gain.value).toBeCloseTo(7.943, 3);
  });

  it('встроенная прибавка компрессора вычитается', () => {
    // Порог −14, сжатие 6: 0,6 × 14 × 5/6 = 7 дБ.
    expect(
      compressorMakeupDb({ threshold: -14, knee: 6, ratio: 6, attack: 0, release: 0 })
    ).toBeCloseTo(7);
    applyPlaybackGain(media(), 0);
    // После компрессора — ослабление на эти 7 дБ.
    expect(contexts[0].gains[1].gain.value).toBeCloseTo(10 ** (-7 / 20), 5);
  });

  it('один контекст на все голосовые; элемент подключается один раз', () => {
    const first = media();
    applyPlaybackGain(first, 6);
    applyPlaybackGain(first, -6);
    applyPlaybackGain(media(), 3);

    expect(contexts).toHaveLength(1);
    expect(contexts[0].createMediaElementSource).toHaveBeenCalledTimes(2);
    expect(contexts[0].gains[0].gain.value).toBeCloseTo(0.501, 3);
  });

  it('отцепленный элемент освобождает все узлы', () => {
    const element = media();
    applyPlaybackGain(element, 6);
    releasePlaybackGain(element);

    const output = outputOf(contexts[0]);
    contexts[0].nodes
      .filter((node) => node !== output)
      .forEach((node) => expect(node.disconnect).toHaveBeenCalled());
    expect(output.disconnect).not.toHaveBeenCalled();
    releasePlaybackGain(element);
  });

  it('Web Audio сломан — не падает, звук идёт как есть', () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        createMediaElementSource() {
          throw new Error('InvalidStateError');
        }
      }
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => applyPlaybackGain(media(), 6)).not.toThrow();
    warn.mockRestore();
  });

  it('без Web Audio — ничего не делает', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => applyPlaybackGain(media(), 6)).not.toThrow();
  });
});

describe('громкость голосовых, выбранная человеком (#874)', () => {
  const output = outputOf;
  const lastOfChain = (context: FakeContext) => context.nodes[context.nodes.length - 2];

  it('уровень — после потолка и ограничителя, последним перед выходом', () => {
    setVoicePlaybackLevel(0.4);
    applyPlaybackGain(media(), 0);

    const [context] = contexts;
    expect(output(context).gain.value).toBe(0.4);
    expect(lastOfChain(context).connect).toHaveBeenCalledWith(output(context));
    expect(context.nodes.at(-1)!.connect).toHaveBeenCalledWith(context.destination);
  });

  it('один уровень на все голосовые и меняется у уже играющих', () => {
    applyPlaybackGain(media(), 0);
    applyPlaybackGain(media(), 3);
    const [context] = contexts;
    const outputs = context.nodes.filter((node) =>
      node.connect.mock.calls.some(([target]) => target === context.destination)
    );

    setVoicePlaybackLevel(0.25);

    expect(outputs).toHaveLength(1);
    expect(output(context).gain.value).toBe(0.25);
  });

  it('громче потолка сделать нельзя: уровень не выше 100%, мусор — 100%', () => {
    applyPlaybackGain(media(), 0);
    const [context] = contexts;

    setVoicePlaybackLevel(3);
    expect(output(context).gain.value).toBe(1);
    setVoicePlaybackLevel(-1);
    expect(output(context).gain.value).toBe(0);
    setVoicePlaybackLevel(Number.NaN);
    expect(output(context).gain.value).toBe(1);
  });

  it('без Web Audio уровень ставится на сам элемент и меняется вместе с ползунком', () => {
    vi.stubGlobal('AudioContext', undefined);
    const element = { volume: 1 } as HTMLMediaElement;
    setVoicePlaybackLevel(0.3);

    applyPlaybackGain(element, 0);
    expect(element.volume).toBe(0.3);

    setVoicePlaybackLevel(0.8);
    expect(element.volume).toBe(0.8);

    releasePlaybackGain(element);
    setVoicePlaybackLevel(0.1);
    expect(element.volume).toBe(0.8);
  });

  it('элемент уже занят другим графом — уровень тоже на самом элементе', () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        createMediaElementSource() {
          throw new Error('InvalidStateError');
        }
        createGain() {
          return {};
        }
      }
    );
    const element = { volume: 1 } as HTMLMediaElement;
    setVoicePlaybackLevel(0.5);

    applyPlaybackGain(element, 0);

    expect(element.volume).toBe(0.5);
  });
});
