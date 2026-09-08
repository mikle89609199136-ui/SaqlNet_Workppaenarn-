import { describe, expect, it } from 'vitest';
import { formatDateDivider, isDifferentDay } from './dateGroup';

describe('dateGroup utils', () => {
  describe('isDifferentDay', () => {
    it('returns true when one of the dates is missing', () => {
      expect(isDifferentDay(undefined, '2026-05-12T10:00:00Z')).toBe(true);
      expect(isDifferentDay('2026-05-12T10:00:00Z', undefined)).toBe(true);
    });

    it('returns false for timestamps on the same day', () => {
      const d1 = '2026-05-12T10:00:00Z';
      const d2 = '2026-05-12T15:30:00Z';
      expect(isDifferentDay(d1, d2)).toBe(false);
    });

    it('returns true for timestamps on different days', () => {
      const d1 = '2026-05-12T10:00:00Z';
      const d2 = '2026-05-13T10:00:00Z';
      expect(isDifferentDay(d1, d2)).toBe(true);
    });

    it('handles Date objects and numeric timestamps safely', () => {
      const now = new Date();
      const sameDayLater = new Date(now.getTime() + 60_000);
      expect(isDifferentDay(now, sameDayLater)).toBe(false);

      const nextDay = new Date(now.getTime() + 25 * 3600 * 1000);
      expect(isDifferentDay(now, nextDay)).toBe(true);
    });
  });

  describe('formatDateDivider', () => {
    const t = (key: string, fallback: string) => fallback;

    it('returns empty string for invalid date', () => {
      expect(formatDateDivider('invalid-date', t)).toBe('');
    });

    it('returns "Сегодня" for today date', () => {
      const now = new Date();
      expect(formatDateDivider(now, t)).toBe('Сегодня');
    });

    it('returns "Вчера" for yesterday date', () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      expect(formatDateDivider(yesterday, t)).toBe('Вчера');
    });

    it('formats older dates with localized day and month', () => {
      const date = new Date('2025-01-15T12:00:00Z');
      const formatted = formatDateDivider(date, t);
      expect(formatted).toContain('январ');
      expect(formatted).toContain('2025');
    });
  });
});
