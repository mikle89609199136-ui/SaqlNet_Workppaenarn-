/**
 * Метаданные голосового сообщения (#843): длительность и огибающая волны.
 *
 * Едут только внутри шифрованного конверта сообщения — сервер их не видит.
 * Нужны получателю сразу, до загрузки файла: у записи Ogg/Opus элемент
 * `<audio>` часто знает длительность лишь после проигрывания до конца, а
 * настоящую волну из файла пришлось бы декодировать.
 *
 * Пришедшее от собеседника — непроверенный ввод: `normalizeVoiceMeta`
 * отбрасывает то, что не похоже на правду, и обрезает значения, а не
 * доверяет им.
 */

/** Самое длинное голосовое — 15 минут. */
export const MAX_VOICE_DURATION_MS = 15 * 60 * 1000;

/** Короче — не отправляем: случайное касание, а не сообщение. */
export const MIN_VOICE_DURATION_MS = 1000;

/** Сколько столбиков в волне пузыря. */
export const VOICE_WAVEFORM_BARS = 64;

/** Уровень столбика: целое 0…31. */
export const VOICE_LEVEL_MAX = 31;

/** Допуск на округления таймеров отправителя. */
const DURATION_TOLERANCE_MS = 5000;

/** Длиннее — это уже не наша волна, а мусор или попытка раздуть память. */
const MAX_WAVEFORM_LENGTH = 128;

/**
 * Выравнивание громкости (#843): к какому уровню речи тянем и в каких
 * пределах. −18 дБFS по среднеквадратичному — разборчиво и с запасом до
 * перегрузки; тихое не усиливаем больше чем на 18 дБ (вытащили бы шум),
 * громкое ослабляем не больше чем на 12.
 */
export const VOICE_TARGET_DBFS = -18;
export const VOICE_GAIN_MIN_DB = -12;
export const VOICE_GAIN_MAX_DB = 18;
/** Тише этого — пауза, а не речь: в громкость речи не входит (−40 дБFS). */
export const SPEECH_RMS_FLOOR = 0.01;

export interface IVoiceMeta {
  durationMs: number;
  /** Уровни 0…VOICE_LEVEL_MAX, обычно VOICE_WAVEFORM_BARS штук. */
  waveform: number[];
  /**
   * Поправка громкости при воспроизведении, дБ: голосовые звучат одинаково
   * громко. Нет — играем как есть (старые сообщения).
   */
  gainDb?: number;
}

/** Вид в конверте — короткие имена: каждое сообщение платит за них байтами. */
export interface IVoiceMetaWire {
  d: number;
  w: number[];
  g?: number;
}

export function toVoiceWire(meta: IVoiceMeta): IVoiceMetaWire {
  return {
    d: Math.round(meta.durationMs),
    w: meta.waveform,
    ...(meta.gainDb !== undefined ? { g: meta.gainDb } : {}),
  };
}

/**
 * Поправка до целевой громкости по среднеквадратичным уровням пачек
 * (0…1). Паузы не считаются: иначе голосовое с долгим молчанием
 * усиливалось бы лишний раз. Округление до 0,5 дБ — точнее ухо не слышит.
 */
export function loudnessGainDb(rmsLevels: number[]): number {
  const speech = rmsLevels.filter((rms) => rms > SPEECH_RMS_FLOOR);
  if (speech.length === 0) return 0;
  const meanSquare = speech.reduce((sum, rms) => sum + rms * rms, 0) / speech.length;
  const loudnessDb = 10 * Math.log10(meanSquare);
  const gain = Math.min(
    VOICE_GAIN_MAX_DB,
    Math.max(VOICE_GAIN_MIN_DB, VOICE_TARGET_DBFS - loudnessDb)
  );
  // `|| 0`: округление даёт −0, а это та же нулевая поправка.
  return Math.round(gain * 2) / 2 || 0;
}

/**
 * Проверка пришедшего: `null`, если это не метаданные голосового. Уровни
 * вне диапазона и дробные приводятся, а не отвергаются — волна от этого
 * не станет опасной.
 */
export function normalizeVoiceMeta(raw: unknown): IVoiceMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const { d, w, g } = raw as Partial<IVoiceMetaWire>;

  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return null;
  if (d > MAX_VOICE_DURATION_MS + DURATION_TOLERANCE_MS) return null;
  if (!Array.isArray(w) || w.length > MAX_WAVEFORM_LENGTH) return null;

  // Поправка громкости необязательна: не число — не применяется, лишнее
  // обрезается до наших пределов (громче +18 дБ собеседник не усилит).
  const gainDb =
    typeof g === 'number' && Number.isFinite(g)
      ? Math.min(VOICE_GAIN_MAX_DB, Math.max(VOICE_GAIN_MIN_DB, g))
      : undefined;

  return {
    durationMs: Math.round(d),
    ...(gainDb !== undefined ? { gainDb } : {}),
    waveform: w.map((level) =>
      typeof level === 'number' && Number.isFinite(level)
        ? Math.min(VOICE_LEVEL_MAX, Math.max(0, Math.round(level)))
        : 0
    ),
  };
}

/**
 * Волна из уровней громкости за всю запись: `bars` столбиков, каждый —
 * пик своего отрезка, растянутые так, что самый громкий — полный.
 * Пики, а не средние: в речи слышны ударные слоги, и волна по средним
 * получается плоской.
 */
export function buildWaveform(levels: number[], bars = VOICE_WAVEFORM_BARS): number[] {
  if (levels.length === 0) return new Array(bars).fill(0);

  const peaks = Array.from({ length: bars }, (_, index) => {
    const from = Math.floor((index * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((index + 1) * levels.length) / bars));
    let peak = 0;
    for (let i = from; i < to && i < levels.length; i++) peak = Math.max(peak, levels[i]);
    return peak;
  });

  const loudest = Math.max(...peaks);
  if (loudest <= 0) return peaks.map(() => 0);
  return peaks.map((peak) => Math.round((peak / loudest) * VOICE_LEVEL_MAX));
}
