import { describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import type { IMessageDto } from '@/types';
import { collectMatches, snippetAround } from './searchMatches';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 10, 12, minute)).toISOString();
const msg = (id: string, content: string, minute: number, extra: Partial<IMessageDto> = {}) =>
  makeMessage({ id, content, createdAt: at(minute), ...extra } as never) as IMessageDto;

describe('отбор найденных сообщений (#841)', () => {
  it('новые сверху, без дублей', () => {
    const old = msg('a', 'созвон в пятницу', 1);
    const fresh = msg('b', 'перенесли созвон', 5);

    expect(collectMatches([old, fresh, old], 'созвон').map(({ id }) => id)).toEqual(['b', 'a']);
  });

  it('нечитаемые и звонки пропускаются без ошибок', () => {
    const locked = msg('x', 'созвон', 2, { undecryptable: 'keyUnavailable' } as never);
    const call = msg('c', '{"callKind":"audio","duration":5}', 3, { type: 'call' } as never);
    const empty = msg('e', '', 4);

    expect(collectMatches([locked, call, empty], 'созвон')).toEqual([]);
    expect(collectMatches([call], 'callKind')).toEqual([]);
  });

  it('фрагмент начинается рядом с совпадением, если оно далеко', () => {
    const long = `${'а'.repeat(80)} созвон`;

    expect(snippetAround('короткий созвон', 'созвон')).toBe('короткий созвон');
    expect(snippetAround(long, 'созвон').startsWith('…')).toBe(true);
    expect(snippetAround(long, 'созвон')).toContain('созвон');
  });
});
