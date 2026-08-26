import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveChat, setChatResolver } from '@/core/chatResolver';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { queryClient } from '../queryClient';
import { chatKeys } from '../keys';
import { registerChatResolver } from './chatResolverBridge';

const CHAT_ID = 'chat-1';

afterEach(() => {
  setChatResolver(null);
  queryClient.clear();
});

describe('источник данных чата для шифрования', () => {
  it('should fail loudly when nothing was registered', async () => {
    // Молчание здесь означало бы сообщение, отправленное без шифрования.
    await expect(resolveChat(CHAT_ID)).rejects.toThrow(/не зарегистрирован/i);
  });

  it('should serve a repeated request from the query cache', async () => {
    let requests = 0;
    server.use(
      http.get(api(`/chats/${CHAT_ID}`), () => {
        requests += 1;
        return HttpResponse.json({
          chat: { id: CHAT_ID, type: 'private', title: 'Чат', peerPublicKey: 'ключ' },
        });
      })
    );
    registerChatResolver();

    await resolveChat(CHAT_ID);
    await resolveChat(CHAT_ID);

    expect(requests).toBe(1);
  });

  it('should not remember a private chat without the peer key', async () => {
    // Ключ собеседника может появиться позже. Запомнив ответ без него,
    // мы оставили бы чат незашифрованным до перезагрузки вкладки.
    server.use(
      http.get(api(`/chats/${CHAT_ID}`), () =>
        HttpResponse.json({
          chat: { id: CHAT_ID, type: 'private', title: 'Чат', peerPublicKey: null },
        })
      )
    );
    registerChatResolver();

    await resolveChat(CHAT_ID);

    expect(queryClient.getQueryData(chatKeys.detail(CHAT_ID))).toBeUndefined();
  });

  it('should keep the loaded thread when the chat record is dropped', async () => {
    // Ключ чата — префикс ключей его истории и закреплённых: удаление по
    // нему унесло бы вместе с записью о чате всю загруженную ленту.
    server.use(
      http.get(api(`/chats/${CHAT_ID}`), () =>
        HttpResponse.json({
          chat: { id: CHAT_ID, type: 'private', title: 'Чат', peerPublicKey: null },
        })
      )
    );
    registerChatResolver();
    queryClient.setQueryData(chatKeys.messages(CHAT_ID), {
      pages: [[{ id: 'm-1' }]],
      pageParams: [0],
    });

    await resolveChat(CHAT_ID);

    expect(queryClient.getQueryData(chatKeys.messages(CHAT_ID))).toBeDefined();
  });

  it('should remember a group chat, which has no peer key by nature', async () => {
    server.use(
      http.get(api(`/chats/${CHAT_ID}`), () =>
        HttpResponse.json({ chat: { id: CHAT_ID, type: 'group', title: 'Группа' } })
      )
    );
    registerChatResolver();

    await resolveChat(CHAT_ID);

    expect(queryClient.getQueryData(chatKeys.detail(CHAT_ID))).toMatchObject({ type: 'group' });
  });
});
