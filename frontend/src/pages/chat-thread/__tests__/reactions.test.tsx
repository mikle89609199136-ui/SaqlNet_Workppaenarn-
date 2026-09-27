import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { fakeSocket } from '@/test/harness/fakeSocket';
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
    expect(screen.getByRole('button', { name: '❤️ 2' })).toBeInTheDocument();

    // Меню действий открывается контекстным меню — это единственный путь к нему
    // с мышью: долгое нажатие обработчик принимает только от touch и pen.
    fireEvent.contextMenu(bubbleText, { clientX: 40, clientY: 40 });

    const thumbsUp = await screen.findByRole('menuitem', { name: '👍' });
    await userEvent.click(thumbsUp);

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe(`/api/v2/messages/${message.id}/reactions`);
    expect(requests[0].body).toEqual({ emoji: '👍' });

    // Реакции в разметке — ровно те, что прислал сервер, включая ту,
    // которая в ответе осталась чужой.
    expect(await screen.findByRole('button', { name: '👍 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '❤️ 2' })).toBeInTheDocument();
  });

  it('заменяет прежнюю реакцию выбранной', async () => {
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

    const thumbsUp = await screen.findByRole('menuitem', { name: '👍' });
    await userEvent.click(thumbsUp);

    /* Без подписки реакция одна, поэтому прежняя снимается и ставится
       новая. Отдельной операции «замени» у сервера нет — он умеет только
       переключать конкретный эмодзи, — отсюда два запроса; заведено
       в #566.

       Показывается замена сразу, не дожидаясь ответа: реакция — жест
       мгновенный. */
    await waitFor(() => expect(screen.getByRole('button', { name: '👍 1' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '❤️ 1' })).toBeNull();

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map((request) => request.body.emoji)).toEqual(['❤️', '👍']);
  });
  it('не возвращает первый эмодзи, если ответ по нему опоздал', async () => {
    /* Два быстрых нажатия подряд: ответ на первое приходит после второго.
       Прежде он перетирал показанное — эмодзи прыгал обратно. */
    const currentUser = makeUser({ id: 'user-1' });
    const chat = makeChat({ id: 'chat-reactions-race' });
    const message = makeMessage({
      chatId: chat.id,
      senderId: 'user-2',
      content: 'сообщение для гонки',
      reactions: [],
    });

    let call = 0;
    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [message] })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.post(api('/messages/:messageId/reactions'), async ({ request }) => {
        const body = (await request.json()) as { emoji: string };
        call += 1;

        // Первый ответ намеренно отстаёт от второго.
        if (call === 1) await new Promise((resolve) => setTimeout(resolve, 300));

        return HttpResponse.json({
          reactions: [{ emoji: body.emoji, count: 1, myReaction: true }],
        });
      })
    );

    renderChatThread({ chat, messages: [message], currentUser });

    const bubbleText = await screen.findByText('сообщение для гонки');
    fireEvent.contextMenu(bubbleText, { clientX: 40, clientY: 40 });
    await userEvent.click(await screen.findByRole('menuitem', { name: '👍' }));

    fireEvent.contextMenu(bubbleText, { clientX: 40, clientY: 40 });
    await userEvent.click(await screen.findByRole('menuitem', { name: '❤️' }));

    // Ждём дольше задержки первого ответа: если бы он применялся, эмодзи
    // сменился бы обратно.
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(screen.getByRole('button', { name: '❤️ 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '👍 1' })).toBeNull();
  });
  it('не показывает промежуточное состояние, пока идёт своя замена', async () => {
    /* Замена — два запроса, и между ними сервер рассылает всем «реакции
       нет». Применив эту весть, интерфейс мигал пустотой вместо только
       что выбранного эмодзи. */
    const currentUser = makeUser({ id: 'user-1' });
    const chat = makeChat({ id: 'chat-reactions-echo' });
    const message = makeMessage({
      chatId: chat.id,
      senderId: 'user-2',
      content: 'сообщение с эхом',
      reactions: [{ emoji: '👍', count: 1, myReaction: true }],
    });

    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [message] })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.post(api('/messages/:messageId/reactions'), async ({ request }) => {
        const body = (await request.json()) as { emoji: string };

        // Пока запрос в пути, сервер успевает рассказать о снятии прежней.
        fakeSocket.emit('reaction_updated', {
          chatId: chat.id,
          messageId: message.id,
          reactions: [],
        });

        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({
          // Отличающееся количество позволяет тесту дождаться не только
          // оптимистического состояния, но и завершения самого запроса.
          reactions: [{ emoji: body.emoji, count: 2, myReaction: true }],
        });
      })
    );

    renderChatThread({ chat, messages: [message], currentUser });

    const bubbleText = await screen.findByText('сообщение с эхом');
    fireEvent.contextMenu(bubbleText, { clientX: 40, clientY: 40 });
    await userEvent.click(await screen.findByRole('menuitem', { name: '❤️' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '❤️ 1' })).toBeInTheDocument());
    expect(await screen.findByRole('button', { name: '❤️ 2' })).toBeInTheDocument();
  });
  it('снимает реакцию нажатием по ней самой, без меню', async () => {
    /* Прежде реакция была `span`, и убрать её можно было только через
       меню по правой кнопке — то есть догадавшись, что оно там есть. */
    const currentUser = makeUser({ id: 'user-1' });
    const chat = makeChat({ id: 'chat-reactions-click' });
    const message = makeMessage({
      chatId: chat.id,
      senderId: 'user-2',
      content: 'сообщение с моей реакцией',
      reactions: [{ emoji: '👍', count: 1, myReaction: true }],
    });

    /* Собираем только запросы по своему сообщению: соседние тесты
       оставляют незавершённые обращения, и они долетают сюда. */
    const отправленные: string[] = [];
    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [message] })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.post(api('/messages/:messageId/reactions'), async ({ params, request }) => {
        const body = (await request.json()) as { emoji: string };
        if (params.messageId === message.id) отправленные.push(body.emoji);
        return HttpResponse.json({ reactions: [] });
      })
    );

    renderChatThread({ chat, messages: [message], currentUser });

    const кнопка = await screen.findByRole('button', { name: '👍 1' });
    expect(кнопка).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(кнопка);

    await waitFor(() => expect(отправленные).toEqual(['👍']));
    expect(screen.queryByRole('button', { name: '👍 1' })).toBeNull();
    // Меню действий при этом не открывается: нажатие до него не доходит.
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
