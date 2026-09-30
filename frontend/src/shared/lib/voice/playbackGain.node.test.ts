import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPlaybackGain,
  compressorMakeupDb,
  releasePlaybackGain,
  resetPlaybackGainContext,
  safePlaybackGainDb,
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

    contexts[0].nodes.forEach((node) => expect(node.disconnect).toHaveBeenCalled());
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
