import { describe, expect, it } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import type { IMessageDto } from '@/types';
import {
  MAX_UNREAD_PAGES,
  countUnreadBelow,
  findFirstUnreadId,
  needsOlderForUnread,
  openingScrollTarget,
  selectReadUpTo,
  takeUnreadSnapshot,
} from './unread';

const ME = 'me';
const at = (minute: number) => new Date(Date.UTC(2026, 8, 29, 12, minute)).toISOString();
const msg = (id: string, minute: number, senderId = 'peer') =>
  makeMessage({ id, senderId, createdAt: at(minute) } as never) as IMessageDto;
/** Время сервера — в виде, в котором его отдаёт Postgres. */
const pgTime = (minute: number) => at(minute).replace('T', ' ').replace('Z', '+00');

const readMark = (lastReadMinute: number | null, unreadCount: number) => ({
  chatId: 'chat-1',
  lastReadAt: lastReadMinute === null ? '' : pgTime(lastReadMinute),
  unreadCount,
});

describe('«Новые сообщения» при открытии (#839)', () => {
  const thread = [msg('a', 1), msg('b', 2, ME), msg('c', 3), msg('d', 4), msg('e', 5, ME)];

  it('первое непрочитанное — первое чужое новее отметки прочтения', () => {
    const snapshot = takeUnreadSnapshot(thread, readMark(2, 2), ME, false, true);
    expect(findFirstUnreadId(thread, snapshot, ME, false)).toBe('c');
  });

  it('сервер не насчитал непрочитанных — разделителя нет', () => {
    const snapshot = takeUnreadSnapshot(thread, readMark(null, 0), ME, true, true);
    expect(findFirstUnreadId(thread, snapshot, ME, true)).toBeNull();
    // И догружать ничего не надо — даже если чат ни разу не читали.
    expect(snapshot.settled).toBe(true);
  });

  it('пришедшее после открытия разделитель не двигает', () => {
    const snapshot = takeUnreadSnapshot(thread.slice(0, 2), readMark(2, 0), ME, false, true);
    expect(findFirstUnreadId(thread, snapshot, ME, false)).toBeNull();
  });

  it('непрочитанных больше загруженного — догрузить, разделитель пока не ставить', () => {
    const page = [msg('c', 3), msg('d', 4)];
    const snapshot = takeUnreadSnapshot(page, readMark(0, 3), ME, true, true);

    expect(snapshot.settled).toBe(false);
    expect(needsOlderForUnread(page, snapshot, ME, true)).toBe(true);
    expect(findFirstUnreadId(page, snapshot, ME, true)).toBeNull();

    // Пришла страница выше: все три на месте.
    const loaded = [msg('a', 1), ...page];
    expect(needsOlderForUnread(loaded, snapshot, ME, true)).toBe(false);
    expect(findFirstUnreadId(loaded, snapshot, ME, true)).toBe('a');
  });

  it('догрузка упёрлась в потолок — разделителя нет', () => {
    const page = [msg('c', 3), msg('d', 4)];
    const snapshot = {
      ...takeUnreadSnapshot(page, readMark(0, 5), ME, true, true),
      pagesLoaded: MAX_UNREAD_PAGES,
    };
    expect(needsOlderForUnread(page, snapshot, ME, true)).toBe(false);
    expect(findFirstUnreadId(page, snapshot, ME, true)).toBeNull();
  });

  it('счётчик устарел, но загружено уже прочитанное — выше не ищем', () => {
    const snapshot = takeUnreadSnapshot(thread, readMark(2, 10), ME, true, true);
    expect(snapshot.settled).toBe(true);
    expect(findFirstUnreadId(thread, snapshot, ME, true)).toBe('c');
  });

  it('без догрузки (нечем) — снимок сразу готов', () => {
    const snapshot = takeUnreadSnapshot([msg('c', 3)], readMark(0, 3), ME, true, false);
    expect(snapshot.settled).toBe(true);
  });
});

describe('число на кнопке «вниз» (#839)', () => {
  const item = (message: IMessageDto) => ({ type: 'message' as const, message });
  const divider = { type: 'unread' as const };

  it('чужие после разделителя ниже экрана', () => {
    const snapshot = takeUnreadSnapshot(
      [msg('a', 1), msg('c', 3)],
      readMark(2, 1),
      ME,
      false,
      true
    );
    const items = [item(msg('a', 1)), divider, item(msg('c', 3)), item(msg('d', 3, ME))];
    expect(countUnreadBelow(items, 0, snapshot, ME)).toBe(1);
    expect(countUnreadBelow(items, 2, snapshot, ME)).toBe(0);
  });

  it('догруженная сверху история новой не считается', () => {
    const snapshot = takeUnreadSnapshot([msg('x', 10)], readMark(10, 0), ME, true, true);
    // Экран — на старом, ниже — догруженное и то, что было при открытии.
    const items = [item(msg('old1', 1)), item(msg('old2', 2)), item(msg('x', 10))];
    expect(countUnreadBelow(items, 0, snapshot, ME)).toBe(0);
  });

  it('пришедшее после открытия — новое', () => {
    const snapshot = takeUnreadSnapshot([msg('x', 10)], readMark(10, 0), ME, false, true);
    const items = [item(msg('x', 10)), item(msg('y', 11)), item(msg('z', 12, ME))];
    expect(countUnreadBelow(items, 0, snapshot, ME)).toBe(1);
  });
});

describe('куда встать при открытии (#839)', () => {
  const m = { type: 'message' as const, message: msg('a', 1) };

  it('на разделитель — к верхнему краю', () => {
    expect(openingScrollTarget([m, { type: 'unread' }, m], false)).toEqual({
      index: 1,
      align: 'start',
    });
  });

  it('без новых — вниз; догрузка упёрлась в потолок — на верх загруженного', () => {
    expect(openingScrollTarget([m, m, m], false)).toEqual({ index: 2, align: 'end' });
    expect(openingScrollTarget([m, m, m], true)).toEqual({ index: 0, align: 'start' });
  });
});

describe('что отметить прочитанным по показу на экране (#919)', () => {
  const message = (source: IMessageDto) => ({ type: 'message' as const, message: source });
  const ids = (list: IMessageDto[]) => list.map((entry) => entry.id);
  const items = [
    message(msg('old', 1)),
    { type: 'unread' as const },
    message(msg('a', 3)),
    message(msg('mine', 4, ME)),
    message(msg('b', 5)),
    message(msg('c', 6)),
  ];

  it('чужие новее отметки — до последнего видимого, не дальше', () => {
    expect(ids(selectReadUpTo(items, 4, pgTime(2), ME))).toEqual(['a', 'b']);
  });

  it('уже отмеченные на клиенте не повторяются', () => {
    const read = [message({ ...msg('a', 3), isRead: true }), message(msg('b', 5))];
    expect(ids(selectReadUpTo(read, 1, pgTime(2), ME))).toEqual(['b']);
  });

  it('чат ещё не читали — всё чужое до видимого', () => {
    expect(ids(selectReadUpTo(items, 5, null, ME))).toEqual(['old', 'a', 'b', 'c']);
  });

  /* Временного id сервер не знает и отклоняет всю пачку (#1067). Пустой
     автор — так выглядело сообщение, восстановленное из очереди. */
  it('неподтверждённые сервером не отмечаются, даже без автора', () => {
    const unsent = [
      message({ ...msg('temp-1', 3, ''), tempId: 'temp-1' }),
      message({ ...msg('temp-2', 4, '') }),
      message({ ...msg('x-pending', 5, ''), status: 'pending' }),
      message({ ...msg('x-uploading', 6, ''), status: 'uploading' }),
      message({ ...msg('x-failed', 7, ''), status: 'failed' }),
      message(msg('peer-ok', 8)),
    ];

    expect(ids(selectReadUpTo(unsent, 5, null, ME))).toEqual(['peer-ok']);
  });
});
