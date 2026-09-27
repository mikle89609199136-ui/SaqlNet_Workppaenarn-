import { describe, expect, it } from 'vitest';
import { buildWaveform, normalizeVoiceMeta, VOICE_LEVEL_MAX } from './voiceMeta';

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
