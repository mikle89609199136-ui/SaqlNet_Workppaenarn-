import { describe, expect, it } from 'vitest';
import { formatChatListTime } from './chatListTime';

const NOW = new Date('2026-09-03T12:00:00');

describe('отметка времени в списке чатов', () => {
  it('показывает часы у сегодняшнего сообщения', () => {
    const result = formatChatListTime(new Date('2026-09-03T09:05:00'), 'ru', NOW);

    expect(result).toBe('09:05');
  });

  it('показывает «вчера» вместо часов', () => {
    const result = formatChatListTime(new Date('2026-09-02T23:59:00'), 'ru', NOW);

    expect(result).toBe('вчера');
  });

  it('вчерашним считает календарный день, а не сутки назад', () => {
    /* Разница меньше суток, но день прошлый: в час ночи вчерашнее
       сообщение не должно выглядеть сегодняшним. */
    const result = formatChatListTime(
      new Date('2026-09-02T13:00:00'),
      'ru',
      new Date('2026-09-03T01:00:00')
    );

    expect(result).toBe('вчера');
  });

  it('показывает день недели на этой неделе', () => {
    const result = formatChatListTime(new Date('2026-08-30T10:00:00'), 'ru', NOW);

    expect(result).toBe('вс');
  });

  it('показывает дату у сообщения старше недели', () => {
    const result = formatChatListTime(new Date('2026-07-14T10:00:00'), 'ru', NOW);

    expect(result).toBe('14.07.26');
  });

  it('время из будущего показывает как сегодняшнее', () => {
    /* Часы клиента и сервера расходятся; «через два дня» в списке
       выглядит поломкой. */
    const result = formatChatListTime(new Date('2026-09-05T08:30:00'), 'ru', NOW);

    expect(result).toBe('08:30');
  });

  it('переводит день недели вместе с языком', () => {
    const result = formatChatListTime(new Date('2026-08-30T10:00:00'), 'en', NOW);

    expect(result).toBe('Sun');
  });

  it('отдаёт пустую строку на пустом и негодном значении', () => {
    expect(formatChatListTime(null, 'ru', NOW)).toBe('');
    expect(formatChatListTime('не дата', 'ru', NOW)).toBe('');
  });
});
