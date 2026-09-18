import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  resolveChat,
  resolveMembers,
  setChatResolver,
  setMembersResolver,
} from './chatResolver';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { queryClient } from '@/shared/api';
import { chatKeys } from './chatKeys';
import { registerChatResolver } from './chatResolverBridge';

const CHAT_ID = 'chat-1';

/* Сброс — перед тестом, а не после. Первая проверка требует, чтобы
   источник не был зарегистрирован, и раньше это обеспечивалось тем, что
   файл выполнялся в собственном окружении. Окружение теперь общее:
   состояние, на котором тест стоит, он обязан готовить сам. */
beforeEach(() => {
  setChatResolver(null);
  setMembersResolver(null);
  queryClient.clear();
});

describe('источник данных чата для шифрования', () => {
  it('should fail loudly when nothing was registered', async () => {
    // Молчание здесь означало бы сообщение, отправленное без шифрования.
    await expect(resolveChat(CHAT_ID)).rejects.toThrow(/не зарегистрирован/i);
    await expect(resolveMembers(CHAT_ID)).rejects.toThrow(/не зарегистрирован/i);
  });

  it('should serve a repeated request from the query cache', async () => {
    let requests = 0;
    server.use(
      http.get(api(`/chats/${CHAT_ID}`), () => {
        requests += 1;
        return HttpResponse.json({ chat: { id: CHAT_ID, type: 'private', title: 'Чат' } });
      })
    );
    registerChatResolver();

    await resolveChat(CHAT_ID);
    await resolveChat(CHAT_ID);

    expect(requests).toBe(1);
  });

  it('should remember the chat record', async () => {
    // Прежде запись о личном чате без ключа собеседника выбрасывалась из
    // кеша: ключ мог появиться позже. Теперь ключ принадлежит чату, а не
    // собеседнику, и выбрасывать нечего.
    server.use(
      http.get(api(`/chats/${CHAT_ID}`), () =>
        HttpResponse.json({ chat: { id: CHAT_ID, type: 'private', title: 'Чат' } })
      )
    );
    registerChatResolver();

    await resolveChat(CHAT_ID);

    expect(queryClient.getQueryData(chatKeys.detail(CHAT_ID))).toMatchObject({ type: 'private' });
  });

  it('should serve chat members for key distribution', async () => {
    // Ключ чата заворачивается для каждого участника отдельно, поэтому
    // шифрованию нужен их список — и берётся он из того же кеша, которым
    // живёт интерфейс.
    server.use(
      http.get(api(`/chats/${CHAT_ID}/members`), () =>
        HttpResponse.json({ members: [{ id: 'user-1' }, { id: 'user-2' }] })
      )
    );
    registerChatResolver();

    const members = await resolveMembers(CHAT_ID);

    expect(members.map((member) => member.id)).toEqual(['user-1', 'user-2']);
  });

  it('should serve a repeated members request from the cache', async () => {
    let requests = 0;
    server.use(
      http.get(api(`/chats/${CHAT_ID}/members`), () => {
        requests += 1;
        return HttpResponse.json({ members: [{ id: 'user-1' }] });
      })
    );
    registerChatResolver();

    await resolveMembers(CHAT_ID);
    await resolveMembers(CHAT_ID);

    expect(requests).toBe(1);
  });
});
