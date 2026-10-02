/*
 * Потолок громкости — общий для голосовых (#843) и звонков (#948):
 * компрессор ужимает громкую речь, ограничитель срезает пики.
 */

export interface IDynamics {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

/** Компрессор: речь у −18 дБFS почти не трогает, громкое сверх −14 — ужимает в 6 раз. */
export const CEILING: IDynamics = {
  threshold: -14,
  knee: 6,
  ratio: 6,
  attack: 0.005,
  release: 0.25,
};
/** Ограничитель: пики не выше −3 дБFS, без хрипа. */
export const LIMITER: IDynamics = {
  threshold: -3,
  knee: 0,
  ratio: 20,
  attack: 0.002,
  release: 0.1,
};

export function decibelsToGain(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Компрессор Web Audio по спецификации сам поднимает выход на
 * (1 / усиление на 0 дБFS)^0,6. Эту прибавку вычитаем — иначе потолок
 * уехал бы вверх, а тихое стало бы громче задуманного.
 */
export function compressorMakeupDb({ threshold, ratio }: IDynamics): number {
  return 0.6 * -threshold * (1 - 1 / ratio);
}

/** Компрессор с вычетом его прибавки: два узла, подключать подряд. */
export function createDynamics(ctx: BaseAudioContext, settings: IDynamics): AudioNode[] {
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
