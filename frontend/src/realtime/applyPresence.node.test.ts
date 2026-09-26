import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { chatKeys, type IChatDto } from '@/entities/chat';
import { userKeys } from '@/entities/user';
import { applyPresence, refreshPresence } from './applyPresence';

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
