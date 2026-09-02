import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renderChatThread } from '@/test/harness/renderChatThread';

interface IReactionRequest {
  url: string;
  method: string;
  body: unknown;
}

describe('реакции на чужое сообщение', () => {
  it('should post the chosen emoji and render the reactions returned by the server', async () => {
    const currentUser = makeUser({ id: 'user-1' });
    const chat = makeChat({ id: 'chat-reactions' });
    // Сообщение чужое: у своего в меню действий другой набор кнопок,
    // а реакция на себя — отдельный случай.
    const message = makeMessage({
      chatId: chat.id,
      senderId: 'user-2',
      senderName: 'Собеседник',
      content: 'сообщение собеседника',
      reactions: [{ emoji: '❤️', count: 2, myReaction: false }],
    });

    const requests: IReactionRequest[] = [];

    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [message] })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.post(api('/messages/:messageId/reactions'), async ({ request }) => {
        requests.push({
          url: new URL(request.url).pathname,
          method: request.method,
          body: await request.json(),
        });

        // Сервер возвращает полный список реакций сообщения, а не только новую.
        return HttpResponse.json({
          reactions: [
            { emoji: '❤️', count: 2, myReaction: false },
            { emoji: '👍', count: 1, myReaction: true },
          ],
        });
      })
    );

    renderChatThread({ chat, messages: [message], currentUser });

    const bubbleText = await screen.findByText('сообщение собеседника');
    expect(screen.getByText('❤️ 2')).toBeInTheDocument();

    // Меню действий открывается контекстным меню — это единственный путь к нему
    // с мышью: долгое нажатие обработчик принимает только от touch и pen.
    fireEvent.contextMenu(bubbleText, { clientX: 40, clientY: 40 });

    const thumbsUp = await screen.findByRole('button', { name: '👍' });
    await userEvent.click(thumbsUp);

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe(`/api/v2/messages/${message.id}/reactions`);
    expect(requests[0].body).toEqual({ emoji: '👍' });

    // Реакции в разметке — ровно те, что прислал сервер, включая ту,
    // которая в ответе осталась чужой.
    expect(await screen.findByText('👍 1')).toBeInTheDocument();
    expect(screen.getByText('❤️ 2')).toBeInTheDocument();
  });

  it('should send no request when the user already reacted to the message', async () => {
    const currentUser = makeUser({ id: 'user-1' });
    const chat = makeChat({ id: 'chat-reactions-repeat' });
    const message = makeMessage({
      chatId: chat.id,
      senderId: 'user-2',
      content: 'сообщение с моей реакцией',
      reactions: [{ emoji: '❤️', count: 1, myReaction: true }],
    });

    const requests: IReactionRequest[] = [];

    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [message] })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.post(api('/messages/:messageId/reactions'), async ({ request }) => {
        requests.push({
          url: new URL(request.url).pathname,
          method: request.method,
          body: await request.json(),
        });
        return HttpResponse.json({ reactions: [{ emoji: '👍', count: 1, myReaction: true }] });
      })
    );

    renderChatThread({ chat, messages: [message], currentUser });

    const bubbleText = await screen.findByText('сообщение с моей реакцией');
    fireEvent.contextMenu(bubbleText, { clientX: 40, clientY: 40 });

    const thumbsUp = await screen.findByRole('button', { name: '👍' });
    await userEvent.click(thumbsUp);

    // ФАКТИЧЕСКОЕ ПОВЕДЕНИЕ: вторая реакция доступна только по подписке —
    // запрос не уходит вовсе, интерфейс молчит, реакция остаётся прежней.
    // Закрытие меню — единственный видимый отклик на нажатие; дождавшись его,
    // мы знаем, что обработчик отработал целиком и запрос уже был бы отправлен.
    await waitFor(() => expect(screen.queryByRole('button', { name: '👍' })).toBeNull());
    expect(requests).toHaveLength(0);
    expect(screen.getByText('❤️ 1')).toBeInTheDocument();
  });
});
