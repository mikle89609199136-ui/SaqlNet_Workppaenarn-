import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { makeChat, makeChatScenario, makeMessage } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

/**
 * Регрессия #174: пересылка в чат, который в этой сессии не открывали,
 * подменяла всю его историю одним пересланным сообщением.
 *
 * Сценарий держится со стороны интерфейса: меню действий → «Переслать» →
 * выбор целевого чата. Утверждения только о теле HTTP-запроса и о разметке.
 */

interface IForwardCall {
  chatId: string;
  body: unknown;
}

/**
 * Исходный чат с историей, целевой чат со своей историей и перехват
 * отправки: пересылка — это обычная отправка пачкой (#808). Список чатов для модалки сервер отдаёт по GET /chats.
 */
function setupForwardScenario() {
  const { chat, messages } = makeChatScenario({ messages: 3 });
  const targetChat = makeChat({ title: 'Целевой чат' });
  const targetHistory = [
    makeMessage({ chatId: targetChat.id, content: 'история цели 1' }),
    makeMessage({ chatId: targetChat.id, content: 'история цели 2' }),
  ];
  const forwarded = makeMessage({
    chatId: targetChat.id,
    content: 'пересланное сообщение',
    isForwarded: true,
  });

  const forwardCalls: IForwardCall[] = [];

  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
    http.get(api(`/chats/${targetChat.id}`), () => HttpResponse.json({ chat: targetChat })),
    http.get(api(`/messages/${targetChat.id}`), () =>
      HttpResponse.json({ messages: targetHistory })
    ),
    http.get(api(`/chats/${targetChat.id}/pins`), () => HttpResponse.json({ pins: [] })),
    http.get(api('/chats'), () => HttpResponse.json({ chats: [chat, targetChat] })),
    http.post(api('/messages/:chatId'), async ({ params, request }) => {
      forwardCalls.push({ chatId: String(params.chatId), body: await request.json() });
      return HttpResponse.json({ messages: [forwarded] });
    })
  );

  return { chat, messages, targetChat, targetHistory, forwarded, forwardCalls };
}

/** Открывает меню действий на сообщении и выбирает в нём «Переслать». */
async function openForwardPicker(messageText: string): Promise<void> {
  // Меню действий вызывается контекстным меню на пузыре сообщения: длинное
  // нажатие требует pointerType 'touch', которого в jsdom нет.
  fireEvent.contextMenu(await screen.findByText(messageText));

  fireEvent.click(await screen.findByRole('menuitem', { name: 'Переслать' }));

  await screen.findByRole('heading', { name: 'Переслать...' });
}

describe('пересылка сообщения в другой чат', () => {
  it('should offer forwarding in the message actions menu', async () => {
    const { chat, messages } = setupForwardScenario();

    renderChatThread({ chat, messages });

    fireEvent.contextMenu(await screen.findByText('сообщение 2'));

    expect(await screen.findByRole('menuitem', { name: 'Переслать' })).toBeInTheDocument();
  });

  it('should open the chat picker without touching the thread history', async () => {
    const { chat, messages, forwardCalls } = setupForwardScenario();

    renderChatThread({ chat, messages });

    await openForwardPicker('сообщение 2');

    // Открытие выбора чата — ещё не пересылка: наружу ничего уходить не должно.
    expect(forwardCalls).toHaveLength(0);
    expect(screen.getByText('сообщение 1')).toBeInTheDocument();
    expect(screen.getByText('сообщение 2')).toBeInTheDocument();
    expect(screen.getByText('сообщение 3')).toBeInTheDocument();
  });

  it('should list no target chats although the server has them', async () => {
    const { chat, messages, targetChat, forwardCalls } = setupForwardScenario();

    renderChatThread({ chat, messages });

    await openForwardPicker('сообщение 2');

    // ФАКТИЧЕСКОЕ ПОВЕДЕНИЕ: список чатов в модалке пуст, хотя GET /chats
    // отдаёт два чата. Страница чата сама список не запрашивает — его
    // наполняет родительская страница списка чатов, которой в этом дереве нет.
    // Дальше сценария (клик по целевому чату → отправка) отсюда не пройти.
    expect(screen.getByText('Чаты не найдены')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(targetChat.title) })).toBeNull();
    expect(forwardCalls).toHaveLength(0);
  });

  it('should close the chat picker on cancel without sending anything', async () => {
    const { chat, messages, forwardCalls } = setupForwardScenario();

    renderChatThread({ chat, messages });

    await openForwardPicker('сообщение 2');

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Переслать...' })).toBeNull();
    });
    expect(forwardCalls).toHaveLength(0);
  });

  it('should not pull a message addressed to another chat into the open thread', async () => {
    const { chat, messages, targetChat, forwarded } = setupForwardScenario();

    renderChatThread({ chat, messages });

    await screen.findByText('сообщение 1');

    // Обратная сторона #174: пересланное сообщение принадлежит другому чату
    // и не должно ни появляться в открытой ленте, ни вытеснять её историю.
    fakeSocket.emit('new_message', { chatId: targetChat.id, message: forwarded });

    await waitFor(() => {
      expect(screen.getByText('сообщение 3')).toBeInTheDocument();
    });
    expect(screen.queryByText('пересланное сообщение')).toBeNull();
    expect(screen.getByText('сообщение 1')).toBeInTheDocument();
    expect(screen.getByText('сообщение 2')).toBeInTheDocument();
  });
});
