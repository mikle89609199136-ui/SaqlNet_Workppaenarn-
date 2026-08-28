import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeChatScenario } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { IChatDto, IMessageDto } from '@/types';

/** Отдаёт странице ровно ту историю, с которой начинается сценарий. */
function serveChat(chat: IChatDto, messages: IMessageDto[]): void {
  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] }))
  );
}

/**
 * Собирает идентификаторы из адресов удалений.
 *
 * Утверждение строится на том, что реально ушло по сети: маршрут и его
 * параметр. Вызов сервиса тут не наблюдается намеренно — при смене слоя
 * доступа к данным запрос останется тем же.
 */
function collectDeletedIds(): string[] {
  const deletedIds: string[] = [];

  server.use(
    http.delete(api('/messages/:messageId'), ({ params }) => {
      deletedIds.push(String(params.messageId));
      return HttpResponse.json({ success: true, lastMessage: null });
    })
  );

  return deletedIds;
}

/**
 * Открывает меню действий сообщения.
 *
 * У пузыря нет видимой кнопки меню: оно вызывается контекстным меню
 * (на телефоне — долгим нажатием), поэтому событие идёт по тексту сообщения
 * и всплывает до обработчика на пузыре.
 */
async function openDeleteAction(messageText: string): Promise<HTMLElement> {
  fireEvent.contextMenu(screen.getByText(messageText));

  return screen.findByRole('button', { name: 'Удалить' });
}

describe('удаление своего сообщения', () => {
  it('should send DELETE /messages/:messageId and remove only that message', async () => {
    const { chat, messages } = makeChatScenario({ messages: 2 });
    serveChat(chat, messages);
    const deletedIds = collectDeletedIds();

    renderChatThread({ chat, messages });

    expect(await screen.findByText('сообщение 1')).toBeInTheDocument();

    await userEvent.click(await openDeleteAction('сообщение 1'));

    await waitFor(() => {
      expect(deletedIds).toEqual([messages[0].id]);
    });
    await waitFor(() => {
      expect(screen.queryByText('сообщение 1')).not.toBeInTheDocument();
    });
    // Соседнее сообщение остаётся на месте — удаление адресное.
    expect(screen.getByText('сообщение 2')).toBeInTheDocument();
  });

  it('should show the empty state after deleting the only message', async () => {
    const { chat, messages } = makeChatScenario({ messages: 1 });
    serveChat(chat, messages);
    const deletedIds = collectDeletedIds();

    renderChatThread({ chat, messages });

    expect(await screen.findByText('сообщение 1')).toBeInTheDocument();

    await userEvent.click(await openDeleteAction('сообщение 1'));

    await waitFor(() => {
      expect(deletedIds).toEqual([messages[0].id]);
    });
    expect(await screen.findByText('Сообщений пока нет')).toBeInTheDocument();
    expect(screen.queryByText('сообщение 1')).not.toBeInTheDocument();
  });
});
