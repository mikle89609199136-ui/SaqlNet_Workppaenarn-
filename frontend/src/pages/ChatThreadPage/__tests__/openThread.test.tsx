import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

interface IReadRequestBody {
  chatId: string;
  messageIds: string[];
}

/**
 * Собирает тела всех POST /messages/read.
 *
 * Отметка о прочтении наблюдаема только как запрос: в DTO сообщения нет поля
 * «прочитано», и в разметке признак ничем не показан.
 */
function captureReadRequests(): IReadRequestBody[] {
  const bodies: IReadRequestBody[] = [];

  server.use(
    http.post(api('/messages/read'), async ({ request }) => {
      bodies.push((await request.json()) as IReadRequestBody);
      return HttpResponse.json({ success: true });
    })
  );

  return bodies;
}

/**
 * Чат из трёх сообщений: чужое, своё, чужое. Своё стоит между чужими,
 * чтобы порядок в разметке нельзя было угадать сортировкой по автору,
 * а список для отметки — простым «взять хвост».
 */
function makeThread() {
  const me = makeUser({ id: 'user-1', firstName: 'Я' });
  const peer = makeUser({ id: 'user-2', firstName: 'Собеседник' });
  const chat = makeChat({ ownerId: me.id, peerId: peer.id });

  const incomingFirst = makeMessage({
    chatId: chat.id,
    senderId: peer.id,
    senderName: 'Собеседник',
    senderFirstName: 'Собеседник',
    content: 'привет, это первое чужое',
  });
  const own = makeMessage({
    chatId: chat.id,
    senderId: me.id,
    content: 'а это моё сообщение',
  });
  const incomingSecond = makeMessage({
    chatId: chat.id,
    senderId: peer.id,
    senderName: 'Собеседник',
    senderFirstName: 'Собеседник',
    content: 'и второе чужое следом',
  });

  const messages = [incomingFirst, own, incomingSecond];

  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] }))
  );

  return { me, chat, messages, incomingFirst, own, incomingSecond };
}

describe('открытие треда', () => {
  it('should show every message in chronological order', async () => {
    const { me, chat, messages } = makeThread();
    captureReadRequests();

    renderChatThread({ chat, messages, currentUser: me });

    expect(await screen.findByText('привет, это первое чужое')).toBeInTheDocument();
    expect(screen.getByText('а это моё сообщение')).toBeInTheDocument();
    expect(screen.getByText('и второе чужое следом')).toBeInTheDocument();

    // Пузырь сообщения — <article>, поэтому порядок в ленте читается ролями,
    // а не селектором по классу вёрстки.
    const bubbles = screen.getAllByRole('article').map((node) => node.textContent ?? '');

    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]).toContain('привет, это первое чужое');
    expect(bubbles[1]).toContain('а это моё сообщение');
    expect(bubbles[2]).toContain('и второе чужое следом');
  });

  it('should send only the incoming message ids to the read endpoint', async () => {
    const { me, chat, messages, incomingFirst, incomingSecond } = makeThread();
    const readRequests = captureReadRequests();

    renderChatThread({ chat, messages, currentUser: me });

    await waitFor(() => expect(readRequests).toHaveLength(1));

    expect(readRequests[0]).toEqual({
      chatId: chat.id,
      messageIds: [incomingFirst.id, incomingSecond.id],
    });
  });

  it('should not report its own message as read', async () => {
    const { me, chat, messages, own } = makeThread();
    const readRequests = captureReadRequests();

    renderChatThread({ chat, messages, currentUser: me });

    await waitFor(() => expect(readRequests).toHaveLength(1));

    expect(readRequests[0].messageIds).not.toContain(own.id);
  });
});
