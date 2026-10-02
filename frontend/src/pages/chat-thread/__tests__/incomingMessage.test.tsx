import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { makeChatScenario, makeMessage, makeUser, resetFixtures } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { mockThreadLayout } from '@/test/harness/threadLayout';
import type { IChatDto, IMessageDto } from '@/types';

/**
 * S10 — входящее сообщение по веб-сокету.
 *
 * Обработчик `new_message` в ChatThreadPage ждёт payload вида
 * `{ chatId, message }` и сам отсеивает события чужих чатов, поэтому
 * событие отправляется ровно в этой форме — через настоящий разбор
 * сообщения в WebSocketClient.
 */

const CURRENT_USER_ID = 'user-1';
const PEER_ID = 'user-2';

/** Тела запросов POST /messages/read, чтобы проверить, что ушло на сервер. */
let readRequests: Array<{ chatId: string; messageIds: string[] }>;

function useChatHandlers(chat: IChatDto, messages: IMessageDto[]) {
  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
    http.post(api('/messages/read'), async ({ request }) => {
      readRequests.push((await request.json()) as { chatId: string; messageIds: string[] });
      return HttpResponse.json({ success: true });
    })
  );
}

describe('входящее сообщение по веб-сокету', () => {
  beforeEach(() => {
    resetFixtures();
    readRequests = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show an incoming message for the open chat exactly once', async () => {
    const { chat, messages } = makeChatScenario({ messages: 2 });
    useChatHandlers(chat, messages);

    renderChatThread({
      chat,
      messages,
      currentUser: makeUser({ id: CURRENT_USER_ID }),
    });

    await screen.findByText('сообщение 2');

    const incoming = makeMessage({
      chatId: chat.id,
      senderId: PEER_ID,
      senderName: 'Собеседник',
      senderFirstName: 'Собеседник',
      content: 'входящее по сокету',
    });

    // Обработчик события асинхронный (расшифровка + отметка о прочтении),
    // поэтому обновление состояния нужно дождаться внутри act.
    await act(async () => {
      fakeSocket.emit('new_message', { chatId: chat.id, message: incoming });
    });

    await waitFor(() => {
      expect(screen.getAllByText('входящее по сокету')).toHaveLength(1);
    });
  });

  it('should not duplicate an incoming message delivered twice', async () => {
    const { chat, messages } = makeChatScenario({ messages: 1 });
    useChatHandlers(chat, messages);

    renderChatThread({
      chat,
      messages,
      currentUser: makeUser({ id: CURRENT_USER_ID }),
    });

    await screen.findByText('сообщение 1');

    const incoming = makeMessage({
      chatId: chat.id,
      senderId: PEER_ID,
      content: 'повторная доставка',
    });

    // Повтор с тем же id — обычное дело при переподключении сокета.
    await act(async () => {
      fakeSocket.emit('new_message', { chatId: chat.id, message: incoming });
    });
    await act(async () => {
      fakeSocket.emit('new_message', { chatId: chat.id, message: incoming });
    });

    await waitFor(() => {
      expect(screen.getAllByText('повторная доставка')).toHaveLength(1);
    });
  });

  it('should keep a message addressed to another chat out of the open thread', async () => {
    const { chat, messages } = makeChatScenario({ messages: 2 });
    const { chat: otherChat } = makeChatScenario({ messages: 0 });
    useChatHandlers(chat, messages);

    renderChatThread({
      chat,
      messages,
      currentUser: makeUser({ id: CURRENT_USER_ID }),
    });

    await screen.findByText('сообщение 2');

    const foreign = makeMessage({
      chatId: otherChat.id,
      senderId: 'user-3',
      content: 'сообщение соседнего чата',
    });
    const sentinel = makeMessage({
      chatId: chat.id,
      senderId: PEER_ID,
      content: 'маячок открытого чата',
    });

    await act(async () => {
      fakeSocket.emit('new_message', { chatId: otherChat.id, message: foreign });
    });
    // Маячок отправлен позже чужого события и проходит тот же асинхронный путь
    // (расшифровка + отметка о прочтении). Его появление в ленте означает, что
    // у чужого события уже было время добавиться — и оно не добавилось.
    await act(async () => {
      fakeSocket.emit('new_message', { chatId: chat.id, message: sentinel });
    });
    await waitFor(() => {
      expect(screen.getAllByText('маячок открытого чата')).toHaveLength(1);
    });

    expect(screen.queryByText('сообщение соседнего чата')).not.toBeInTheDocument();
    // Открытый тред не должен потерять собственную историю из-за чужого события.
    expect(screen.getByText('сообщение 1')).toBeInTheDocument();
    expect(screen.getByText('сообщение 2')).toBeInTheDocument();
  });

  it('should mark only the incoming message of the open chat as read', async () => {
    mockThreadLayout({ viewport: 20_000 });
    const { chat, messages } = makeChatScenario({ messages: 1 });
    const { chat: otherChat } = makeChatScenario({ messages: 0 });
    useChatHandlers(chat, messages);

    renderChatThread({
      chat,
      messages,
      currentUser: makeUser({ id: CURRENT_USER_ID }),
    });

    await screen.findByText('сообщение 1');
    readRequests.length = 0;

    const foreign = makeMessage({
      chatId: otherChat.id,
      senderId: 'user-3',
      content: 'чужое без отметки',
    });
    const incoming = makeMessage({
      chatId: chat.id,
      senderId: PEER_ID,
      content: 'входящее с отметкой',
    });

    // Чужое событие идёт первым: если бы страница на него реагировала,
    // его запрос ушёл бы раньше запроса по сообщению открытого чата.
    await act(async () => {
      fakeSocket.emit('new_message', { chatId: otherChat.id, message: foreign });
    });
    await act(async () => {
      fakeSocket.emit('new_message', { chatId: chat.id, message: incoming });
    });

    await waitFor(() => {
      expect(readRequests).toEqual([{ chatId: chat.id, messageIds: [incoming.id] }]);
    });
    expect(screen.getByText('входящее с отметкой')).toBeInTheDocument();
  });
});
