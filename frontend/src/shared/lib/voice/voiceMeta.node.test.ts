import { describe, expect, it } from 'vitest';
import {
  buildWaveform,
  loudnessGainDb,
  normalizeVoiceMeta,
  toVoiceWire,
  VOICE_GAIN_MAX_DB,
  VOICE_GAIN_MIN_DB,
  VOICE_LEVEL_MAX,
} from './voiceMeta';

describe('волна голосового (#843)', () => {
  it('ровно столько столбиков, сколько просили, самый громкий — полный', () => {
    const levels = Array.from({ length: 640 }, (_, i) => (i % 64) / 64);
    const waveform = buildWaveform(levels, 64);

    expect(waveform).toHaveLength(64);
    expect(Math.max(...waveform)).toBe(VOICE_LEVEL_MAX);
    expect(waveform.every((level) => level >= 0 && level <= VOICE_LEVEL_MAX)).toBe(true);
  });

  it('короткая запись: уровней меньше, чем столбиков, — не падает', () => {
    expect(buildWaveform([0.2, 0.9], 64)).toHaveLength(64);
  });

  it('тишина и пустая запись — нули', () => {
    expect(buildWaveform([0, 0, 0], 8)).toEqual(new Array(8).fill(0));
    expect(buildWaveform([], 8)).toEqual(new Array(8).fill(0));
  });
});

describe('проверка пришедших метаданных', () => {
  it.each([null, 'строка', 42, {}, { d: 1000 }, { d: '1000', w: [] }, { d: 1000, w: 'abc' }])(
    'не метаданные: %j',
    (raw) => {
      expect(normalizeVoiceMeta(raw)).toBeNull();
    }
  );

  it('годные — приводятся к целым', () => {
    expect(normalizeVoiceMeta({ d: 1500.4, w: [3.2, 30.9] })).toEqual({
      durationMs: 1500,
      waveform: [3, 31],
    });
  });
});

describe('выравнивание громкости', () => {
  it('тянет речь к −18 дБFS', () => {
    // 0,0398 ≈ −28 дБFS: усилить на 10.
    expect(loudnessGainDb([0.0398, 0.0398])).toBe(10);
    // 0,126 ≈ −18 дБFS: уже как надо.
    expect(loudnessGainDb([0.126])).toBe(0);
  });

  it('паузы не считаются: долгое молчание не делает голос громче', () => {
    expect(loudnessGainDb([0.126, 0, 0, 0, 0.001, 0.005])).toBe(0);
  });

  it('тишина — без поправки; крайности обрезаются', () => {
    expect(loudnessGainDb([])).toBe(0);
    expect(loudnessGainDb([0, 0.002])).toBe(0);
    expect(loudnessGainDb([0.011])).toBe(VOICE_GAIN_MAX_DB);
    expect(loudnessGainDb([1, 1])).toBe(VOICE_GAIN_MIN_DB);
  });

  it('поправка едет в конверте и проверяется на входе', () => {
    const wire = toVoiceWire({ durationMs: 1000, waveform: [1], gainDb: 6.5 });
    expect(wire.g).toBe(6.5);
    expect(normalizeVoiceMeta(wire)?.gainDb).toBe(6.5);
    expect(toVoiceWire({ durationMs: 1000, waveform: [1] })).not.toHaveProperty('g');

    expect(normalizeVoiceMeta({ d: 1000, w: [1], g: 1000 })?.gainDb).toBe(VOICE_GAIN_MAX_DB);
    expect(normalizeVoiceMeta({ d: 1000, w: [1], g: -25 })?.gainDb).toBe(VOICE_GAIN_MIN_DB);
    for (const g of [Number.NaN, Infinity, '6', null]) {
      const meta = normalizeVoiceMeta({ d: 1000, w: [1], g });
      expect(meta).not.toBeNull();
      expect(meta).not.toHaveProperty('gainDb');
    }
  });
});
