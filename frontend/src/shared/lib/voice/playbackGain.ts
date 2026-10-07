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
import { CEILING, createDynamics, decibelsToGain, LIMITER } from '../audio/dynamics';
import { VOICE_GAIN_MAX_DB, VOICE_GAIN_MIN_DB } from './voiceMeta';

interface IPlaybackChain {
  nodes: AudioNode[];
  gain: GainNode;
}

let context: AudioContext | null = null;
const chains = new WeakMap<HTMLMediaElement, IPlaybackChain>();

/** Поправка, которой доверяем: только конечное число и только в наших пределах. */
export function safePlaybackGainDb(gainDb: number | undefined): number {
  if (gainDb === undefined || !Number.isFinite(gainDb)) return 0;
  return Math.min(VOICE_GAIN_MAX_DB, Math.max(VOICE_GAIN_MIN_DB, gainDb));
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
