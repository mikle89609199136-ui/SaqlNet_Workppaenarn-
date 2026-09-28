import { describe, expect, it } from 'vitest';
import { getChatSubtitle } from './getChatSubtitle';

/* Простая замена переводчику: подставляет count и выбирает форму по-русски. */
const t = (key: string | Record<string, unknown>, options?: Record<string, unknown> | string) => {
  if (typeof options === 'string') return options;
  const count = Number(options?.count);
  const forms: Record<string, [string, string, string]> = {
    membersCount: ['участник', 'участника', 'участников'],
  };
  if (typeof key === 'string' && forms[key]) {
    const [one, few, many] = forms[key];
    const m10 = count % 10;
    const m100 = count % 100;
    const form =
      m10 === 1 && m100 !== 11
        ? one
        : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
          ? few
          : many;
    return `${count} ${form}`;
  }
  if (key === 'onlineCount') return `${count} в сети`;
  return String(options?.defaultValue ?? key);
};

describe('подзаголовок группы (#822)', () => {
  const group = { type: 'group', memberCount: 5 };

  it('число участников и сколько в сети — как в макете', () => {
    expect(getChatSubtitle(group, null, t, new Date(), 2)).toBe('5 участников, 2 в сети');
  });

  it('никого в сети — только участники', () => {
    expect(getChatSubtitle(group, null, t, new Date(), 0)).toBe('5 участников');
    expect(getChatSubtitle(group, null, t, new Date())).toBe('5 участников');
  });

  it('форма слова по числу', () => {
    expect(getChatSubtitle({ type: 'group', memberCount: 1 }, null, t)).toBe('1 участник');
    expect(getChatSubtitle({ type: 'group', memberCount: 3 }, null, t)).toBe('3 участника');
  });

  it('печатает — важнее числа участников', () => {
    expect(getChatSubtitle(group, 'Игорь печатает…', t, new Date(), 2)).toBe('Игорь печатает…');
  });
});
