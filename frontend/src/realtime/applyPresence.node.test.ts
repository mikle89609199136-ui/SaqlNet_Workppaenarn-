import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatKeys, type IChatDto } from '@/entities/chat';
import { userKeys } from '@/entities/user';
import {
  applyPresence,
  createPresenceBuffer,
  PRESENCE_OFFLINE_DELAY_MS,
  refreshPresence,
} from './applyPresence';

const chat = (id: string, peerId: string, extra: Partial<IChatDto> = {}) =>
  ({ id, type: 'private', peerId, peerIsOnline: false, ...extra }) as IChatDto;

function seededClient() {
  const client = new QueryClient();
  client.setQueryData(chatKeys.list(), [chat('c1', 'anna'), chat('c2', 'boris')]);
  client.setQueryData(chatKeys.archived(), [chat('c3', 'anna')]);
  client.setQueryData(chatKeys.detail('c1'), chat('c1', 'anna'));
  client.setQueryData(chatKeys.messages('c1'), { pages: [], pageParams: [] });
  client.setQueryData(userKeys.profile('anna'), { id: 'anna', isOnline: false });
  return client;
}

describe('статус собеседника из события (#780)', () => {
  it('меняет статус в списке, архиве, шапке чата и профиле сразу', () => {
    const client = seededClient();

    applyPresence(client, {
      type: 'presence_changed',
      userId: 'anna',
      isOnline: true,
      lastSeen: '2026-09-26T12:30:00Z',
    });

    const list = client.getQueryData<IChatDto[]>(chatKeys.list())!;
    expect(list[0]).toMatchObject({ peerIsOnline: true, peerLastSeen: '2026-09-26T12:30:00Z' });
    // Чужой чат не задет.
    expect(list[1].peerIsOnline).toBe(false);
    expect(client.getQueryData<IChatDto[]>(chatKeys.archived())![0].peerIsOnline).toBe(true);
    expect(client.getQueryData<IChatDto>(chatKeys.detail('c1'))!.peerIsOnline).toBe(true);
    expect(client.getQueryData(userKeys.profile('anna'))).toMatchObject({ isOnline: true });
  });

  it('не трогает историю чата и не создаёт кеш, которого не было', () => {
    const client = seededClient();
    const messages = client.getQueryData(chatKeys.messages('c1'));

    applyPresence(client, {
      type: 'presence_changed',
      userId: 'nobody-cached',
      isOnline: true,
      lastSeen: '',
    });

    expect(client.getQueryData(chatKeys.messages('c1'))).toBe(messages);
    expect(client.getQueryData(userKeys.profile('nobody-cached'))).toBeUndefined();
  });

  it('перечитывание помечает устаревшими только списки и карточки чатов', () => {
    const client = seededClient();

    refreshPresence(client);

    expect(client.getQueryState(chatKeys.list())?.isInvalidated).toBe(true);
    expect(client.getQueryState(chatKeys.detail('c1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(chatKeys.messages('c1'))?.isInvalidated).toBe(false);
  });
});

describe('задержка выхода: без мигания при обрыве связи', () => {
  const event = (isOnline: boolean, lastSeen = '2026-09-26T12:30:00Z') => ({
    type: 'presence_changed' as const,
    userId: 'anna',
    isOnline,
    lastSeen,
  });
  const annaOnline = (client: QueryClient) =>
    client.getQueryData<IChatDto>(chatKeys.detail('c1'))!.peerIsOnline;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('вход показывает сразу', () => {
    const client = seededClient();
    createPresenceBuffer(client).push(event(true));

    expect(annaOnline(client)).toBe(true);
  });

  it('выход — только через полминуты', () => {
    const client = seededClient();
    const buffer = createPresenceBuffer(client);
    buffer.push(event(true));

    buffer.push(event(false, '2026-09-26T12:31:00Z'));
    vi.advanceTimersByTime(PRESENCE_OFFLINE_DELAY_MS - 1);
    expect(annaOnline(client)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(annaOnline(client)).toBe(false);
    // «Был(а)» — время выхода, а не момент, когда его показали.
    expect(client.getQueryData<IChatDto>(chatKeys.detail('c1'))!.peerLastSeen).toBe(
      '2026-09-26T12:31:00Z'
    );
    expect(client.getQueryData(userKeys.profile('anna'))).toMatchObject({ isOnline: false });
  });

  it('вернулся раньше — выход не показывается вовсе', () => {
    const client = seededClient();
    const buffer = createPresenceBuffer(client);
    buffer.push(event(true));

    buffer.push(event(false));
    vi.advanceTimersByTime(10_000);
    buffer.push(event(true));
    vi.advanceTimersByTime(PRESENCE_OFFLINE_DELAY_MS * 2);

    expect(annaOnline(client)).toBe(true);
  });

  it('несколько обрывов подряд — отсчёт от последнего выхода', () => {
    const client = seededClient();
    const buffer = createPresenceBuffer(client);
    buffer.push(event(true));

    buffer.push(event(false));
    vi.advanceTimersByTime(20_000);
    buffer.push(event(true));
    buffer.push(event(false));
    vi.advanceTimersByTime(20_000);
    expect(annaOnline(client)).toBe(true);

    vi.advanceTimersByTime(10_000);
    expect(annaOnline(client)).toBe(false);
  });

  it('задержка у каждого своя', () => {
    const client = seededClient();
    client.setQueryData(chatKeys.list(), [
      chat('c1', 'anna', { peerIsOnline: true }),
      chat('c2', 'boris', { peerIsOnline: true }),
    ]);
    const buffer = createPresenceBuffer(client);

    buffer.push({ ...event(false), userId: 'anna' });
    vi.advanceTimersByTime(15_000);
    buffer.push({ ...event(false), userId: 'boris' });
    vi.advanceTimersByTime(15_000);

    const list = client.getQueryData<IChatDto[]>(chatKeys.list())!;
    expect(list.map((item) => item.peerIsOnline)).toEqual([false, true]);
  });

  it('после dispose отложенный выход не применяется', () => {
    const client = seededClient();
    const buffer = createPresenceBuffer(client);
    buffer.push(event(true));
    buffer.push(event(false));

    buffer.dispose();
    vi.advanceTimersByTime(PRESENCE_OFFLINE_DELAY_MS);

    expect(annaOnline(client)).toBe(true);
  });
});
