import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { makeChatScenario, makePin } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

interface IRecordedRequest {
  method: string;
  url: string;
}

/**
 * Чат с двумя сообщениями и записью всех обращений к закреплениям.
 * Тест утверждает только о содержимом этого списка и о разметке.
 */
function setupChat() {
  const { chat, messages } = makeChatScenario({ messages: 2 });
  const pinRequests: IRecordedRequest[] = [];

  const record = ({ request }: { request: Request }) => {
    pinRequests.push({ method: request.method, url: request.url });
    return HttpResponse.json({ success: true });
  };

  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
    http.post(api('/chats/:chatId/pins/:messageId'), record),
    http.delete(api('/chats/:chatId/pins/:messageId'), record)
  );

  return { chat, messages, pinRequests };
}

/**
 * Пузырь сообщения в ленте. Искать просто по тексту нельзя: после
 * закрепления тот же текст показан ещё и в навигаторе закреплённых.
 */
function messageBubble(content: string): HTMLElement {
  const bubble = screen
    .getAllByRole('article')
    .find((element) => within(element).queryByText(content) !== null);

  if (!bubble) {
    throw new Error(`Сообщение «${content}» не найдено в ленте`);
  }

  return bubble;
}

/** Меню действий открывается правой кнопкой по сообщению. */
async function openMessageActions(content: string) {
  fireEvent.contextMenu(messageBubble(content));
  await screen.findByRole('menuitem', { name: 'Копировать' });
}

describe('закрепление сообщения', () => {
  it('should post the pin and show the pinned message after the server confirms it', async () => {
    const user = userEvent.setup();
    const { chat, messages, pinRequests } = setupChat();
    const target = messages[0];

    renderChatThread({ chat, messages });

    expect(await screen.findByText('сообщение 1')).toBeInTheDocument();
    // До закрепления навигатора нет — иначе проверка ниже ничего не значит.
    expect(screen.queryByRole('button', { name: 'Закреплённые сообщения' })).toBeNull();

    await openMessageActions('сообщение 1');
    await user.click(screen.getByRole('menuitem', { name: 'Закрепить' }));

    await waitFor(() => expect(pinRequests).toHaveLength(1));
    expect(pinRequests[0]).toEqual({
      method: 'POST',
      url: api(`/chats/${chat.id}/pins/${target.id}`),
    });

    // Ответ на POST закреплённое в интерфейсе не показывает: страница ждёт
    // события сокета с полем pin — только оно наполняет навигатор.
    expect(screen.queryByRole('button', { name: 'Закреплённые сообщения' })).toBeNull();

    await act(async () => {
      fakeSocket.emit('message_pinned', {
        chatId: chat.id,
        messageId: target.id,
        pin: makePin({ chatId: chat.id, message: { ...target, isPinned: true } }),
      });
    });

    const navigator = await screen.findByRole('button', { name: 'Закреплённые сообщения' });
    expect(within(navigator).getByText('Закреплённое сообщение')).toBeInTheDocument();
    expect(within(navigator).getByText('сообщение 1')).toBeInTheDocument();
  });

  it('should delete the pin and drop it from the navigator after the server confirms it', async () => {
    const user = userEvent.setup();
    const { chat, messages, pinRequests } = setupChat();
    const target = messages[0];
    const pin = makePin({ chatId: chat.id, message: { ...target, isPinned: true } });

    renderChatThread({ chat, messages, pins: [pin] });

    const navigator = await screen.findByRole('button', { name: 'Закреплённые сообщения' });
    expect(within(navigator).getByText('сообщение 1')).toBeInTheDocument();

    // У закреплённого сообщения в меню другой пункт — по нему видно,
    // что страница считает сообщение закреплённым.
    await openMessageActions('сообщение 1');
    await user.click(screen.getByRole('menuitem', { name: 'Открепить' }));

    await waitFor(() => expect(pinRequests).toHaveLength(1));
    expect(pinRequests[0]).toEqual({
      method: 'DELETE',
      url: api(`/chats/${chat.id}/pins/${pin.messageId}`),
    });

    // Ответ на DELETE навигатор не убирает — ждём подтверждения сокетом.
    expect(screen.getByRole('button', { name: 'Закреплённые сообщения' })).toBeInTheDocument();

    await act(async () => {
      fakeSocket.emit('message_unpinned', { chatId: chat.id, messageId: pin.messageId });
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Закреплённые сообщения' })).toBeNull();
    });
    // Само сообщение остаётся в ленте: открепление убирает только закрепление.
    expect(screen.getByText('сообщение 1')).toBeInTheDocument();
  });

  it('should scroll and highlight target message when navigator is clicked', async () => {
    const user = userEvent.setup();
    const { chat, messages } = setupChat();
    const target = messages[0];
    const pin = makePin({ chatId: chat.id, message: { ...target, isPinned: true } });

    renderChatThread({ chat, messages, pins: [pin] });

    const navigator = await screen.findByRole('button', { name: 'Закреплённые сообщения' });
    await user.click(navigator);

    await waitFor(() => {
      expect(useChatUiStore.getState().highlightedMessageId).toBe(target.id);
    });

    const targetBubble = messageBubble('сообщение 1');
    const bubbleInner = targetBubble.querySelector('.message-bubble');
    expect(bubbleInner?.className).toContain('animate-[msg-flash_1200ms_ease-out]');
  });
});
