/**
 * Громкость голосового при воспроизведении (#843).
 *
 * 1. Выравнивание: отправитель считает поправку по своей записи и кладёт её
 *    в шифрованные метаданные (`IVoiceMeta.gainDb`); сам файл не меняется.
 * 2. Потолок: поправке и файлу мы не доверяем — собеседник мог прислать и
 *    поддельную поправку, и файл на полной громкости. Поэтому каждое
 *    голосовое проходит через компрессор (заметно громче нормальной речи —
 *    ужимается) и ограничитель пиков. Замер в Chromium: речь на −18 дБFS
 *    выходит на −19, а худший случай — файл на полной громкости плюс
 *    наибольшая поправка — на −8 дБFS вместо 0: громче обычного, но не
 *    оглушает.
 *
 * Граф строится при первом запуске, по нажатию: браузер разрешает звук из
 * AudioContext только после жеста человека. Один контекст на вкладку, а не
 * на каждое сообщение: контексты дорогие и их число ограничено.
 */
import { VOICE_GAIN_MAX_DB, VOICE_GAIN_MIN_DB } from './voiceMeta';

interface IDynamics {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

/** Компрессор: речь у −18 дБFS почти не трогает, громкое сверх −14 — ужимает в 6 раз. */
const CEILING: IDynamics = { threshold: -14, knee: 6, ratio: 6, attack: 0.005, release: 0.25 };
/** Ограничитель: пики не выше −3 дБFS, без хрипа. */
const LIMITER: IDynamics = { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.1 };

interface IPlaybackChain {
  nodes: AudioNode[];
  gain: GainNode;
}

let context: AudioContext | null = null;
const chains = new WeakMap<HTMLMediaElement, IPlaybackChain>();

function decibelsToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Поправка, которой доверяем: только конечное число и только в наших пределах. */
export function safePlaybackGainDb(gainDb: number | undefined): number {
  if (gainDb === undefined || !Number.isFinite(gainDb)) return 0;
  return Math.min(VOICE_GAIN_MAX_DB, Math.max(VOICE_GAIN_MIN_DB, gainDb));
}

/**
 * Компрессор Web Audio по спецификации сам поднимает выход на
 * (1 / усиление на 0 дБFS)^0,6. Эту прибавку вычитаем — иначе потолок
 * уехал бы вверх, а тихое стало бы громче задуманного.
 */
export function compressorMakeupDb({ threshold, ratio }: IDynamics): number {
  return 0.6 * -threshold * (1 - 1 / ratio);
}

function createDynamics(ctx: AudioContext, settings: IDynamics): AudioNode[] {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = settings.threshold;
  compressor.knee.value = settings.knee;
  compressor.ratio.value = settings.ratio;
  compressor.attack.value = settings.attack;
  compressor.release.value = settings.release;
  const trim = ctx.createGain();
  trim.gain.value = decibelsToGain(-compressorMakeupDb(settings));
  return [compressor, trim];
}

/**
 * Пропустить звук элемента через поправку и потолок. Звать из обработчика
 * нажатия, до `play()`. Не получилось (нет Web Audio, элемент уже занят
 * другим графом) — звук идёт как есть: голосовое всё равно играет.
 */
export function applyPlaybackGain(media: HTMLMediaElement, gainDb: number | undefined): void {
  const linear = decibelsToGain(safePlaybackGainDb(gainDb));
  const existing = chains.get(media);
  if (existing) {
    existing.gain.gain.value = linear;
    void context?.resume().catch(() => undefined);
    return;
  }
  if (typeof AudioContext === 'undefined') return;

  try {
    context ??= new AudioContext();
    const source = context.createMediaElementSource(media);
    const gain = context.createGain();
    gain.gain.value = linear;
    const nodes: AudioNode[] = [
      source,
      gain,
      ...createDynamics(context, CEILING),
      ...createDynamics(context, LIMITER),
    ];
    nodes.reduce((from, to) => from.connect(to));
    nodes[nodes.length - 1].connect(context.destination);
    chains.set(media, { nodes, gain });
  } catch (error) {
    console.warn('Потолок громкости голосового недоступен', error);
    return;
  }
  void context.resume().catch(() => undefined);
}

/** Отцепить элемент от графа — при размонтировании плеера, чтобы узлы не копились. */
export function releasePlaybackGain(media: HTMLMediaElement): void {
  const chain = chains.get(media);
  if (!chain) return;
  chains.delete(media);
  chain.nodes.forEach((node) => node.disconnect());
}

/** Для тестов: забыть общий контекст. */
export function resetPlaybackGainContext(): void {
  context = null;
}
