import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeChatScenario, makeMessage } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { useChatUiStore } from '@/entities/chat';
import { clearToasts, getToasts } from '@/shared/ui';
import type { IChatDto, IMessageDto } from '@/types';

/** Отдаёт странице ровно ту историю, с которой начинается сценарий. */
function serveChat(chat: IChatDto, messages: IMessageDto[]): void {
  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] }))
  );
}

interface IDeleteRequest {
  messageIds: string[];
  forEveryone: boolean;
}

/**
 * Собирает тела запросов удаления (#840).
 *
 * Утверждение строится на том, что реально ушло по сети: маршрут и тело.
 * Вызов сервиса тут не наблюдается намеренно — при смене слоя доступа к
 * данным запрос останется тем же.
 */
function collectDeletes(chat: IChatDto, status = 200): IDeleteRequest[] {
  const requests: IDeleteRequest[] = [];
  server.use(
    http.post(api(`/chats/${chat.id}/messages/delete`), async ({ request }) => {
      requests.push((await request.json()) as IDeleteRequest);
      return status === 200
        ? HttpResponse.json({ success: true, lastMessage: null })
        : HttpResponse.json({ code: 'access_denied' }, { status });
    })
  );
  return requests;
}

/**
 * Открывает меню действий сообщения и выбирает пункт.
 *
 * У пузыря нет видимой кнопки меню: оно вызывается контекстным меню
 * (на телефоне — долгим нажатием), поэтому событие идёт по тексту сообщения
 * и всплывает до обработчика на пузыре.
 */
async function chooseAction(messageText: string, action: string): Promise<void> {
  fireEvent.contextMenu(await screen.findByText(messageText));
  await userEvent.click(await screen.findByRole('menuitem', { name: action }));
}

const dialog = () => screen.findByRole('alertdialog');

beforeEach(() => {
  useChatUiStore.setState({ deleteTargets: null, selectedMessages: [], selectionMode: false });
  clearToasts();
});

describe('удаление сообщения (#840)', () => {
  it('своё — с подтверждением и галочкой «и у собеседника», включённой по умолчанию', async () => {
    const { chat, messages } = makeChatScenario({ messages: 2 });
    serveChat(chat, messages);
    const requests = collectDeletes(chat);
    renderChatThread({ chat, messages });

    await chooseAction('сообщение 1', 'Удалить');

    const confirm = await dialog();
    expect(within(confirm).getByText('Удалить сообщение?')).toBeInTheDocument();
    expect(
      within(confirm).getByRole('checkbox', { name: 'Удалить и у собеседника' })
    ).toBeChecked();
    // До подтверждения ничего не ушло.
    expect(requests).toHaveLength(0);

    await userEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));

    await waitFor(() =>
      expect(requests).toEqual([{ messageIds: [messages[0].id], forEveryone: true }])
    );
    await waitFor(() => expect(screen.queryByText('сообщение 1')).not.toBeInTheDocument());
    // Соседнее сообщение остаётся на месте — удаление адресное.
    expect(screen.getByText('сообщение 2')).toBeInTheDocument();
  });

  it('своё без галочки — только у себя', async () => {
    const { chat, messages } = makeChatScenario({ messages: 1 });
    serveChat(chat, messages);
    const requests = collectDeletes(chat);
    renderChatThread({ chat, messages });

    await chooseAction('сообщение 1', 'Удалить');
    const confirm = await dialog();
    await userEvent.click(
      within(confirm).getByRole('checkbox', { name: 'Удалить и у собеседника' })
    );
    expect(within(confirm).getByText('Сообщения исчезнут только у вас.')).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));

    await waitFor(() =>
      expect(requests).toEqual([{ messageIds: [messages[0].id], forEveryone: false }])
    );
    // Удалено единственное — пустая лента.
    expect(await screen.findByText('Сообщений пока нет')).toBeInTheDocument();
  });

  it('чужое — удаляется только у себя, галочки нет', async () => {
    const { chat } = makeChatScenario({ messages: 0 });
    const theirs = makeMessage({ chatId: chat.id, senderId: 'user-2', content: 'от собеседника' });
    serveChat(chat, [theirs]);
    const requests = collectDeletes(chat);
    renderChatThread({ chat, messages: [theirs] });

    await chooseAction('от собеседника', 'Удалить');

    const confirm = await dialog();
    expect(within(confirm).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(confirm).getByText('Сообщения исчезнут только у вас.')).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));

    await waitFor(() =>
      expect(requests).toEqual([{ messageIds: [theirs.id], forEveryone: false }])
    );
  });

  it('в группе галочка называется «Удалить у всех»', async () => {
    const { chat, messages } = makeChatScenario({ messages: 1, chat: { type: 'group' } });
    serveChat(chat, messages);
    collectDeletes(chat);
    renderChatThread({ chat, messages });

    await chooseAction('сообщение 1', 'Удалить');

    const confirm = await dialog();
    expect(within(confirm).getByRole('checkbox', { name: 'Удалить у всех' })).toBeChecked();
    expect(within(confirm).getByText('Сообщения исчезнут у всех участников.')).toBeInTheDocument();
  });

  it('отмена — ничего не уходит, сообщение на месте', async () => {
    const { chat, messages } = makeChatScenario({ messages: 1 });
    serveChat(chat, messages);
    const requests = collectDeletes(chat);
    renderChatThread({ chat, messages });

    await chooseAction('сообщение 1', 'Удалить');
    const confirm = await dialog();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(requests).toHaveLength(0);
    expect(screen.getByText('сообщение 1')).toBeInTheDocument();
  });

  it('отказ сервера — тост, диалог открыт, сообщение на месте', async () => {
    const { chat, messages } = makeChatScenario({ messages: 1 });
    serveChat(chat, messages);
    collectDeletes(chat, 403);
    renderChatThread({ chat, messages });

    await chooseAction('сообщение 1', 'Удалить');
    const confirm = await dialog();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));

    await waitFor(() =>
      expect(getToasts()).toContainEqual(expect.objectContaining({ type: 'error' }))
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('сообщение 1')).toBeInTheDocument();
  });

  it('выбранные — одним запросом, в заголовке число', async () => {
    const { chat, messages } = makeChatScenario({ messages: 3 });
    serveChat(chat, messages);
    const requests = collectDeletes(chat);
    renderChatThread({ chat, messages });

    await chooseAction('сообщение 1', 'Выбрать');
    await chooseAction('сообщение 3', 'Выбрать');
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

    const confirm = await dialog();
    expect(within(confirm).getByText('Удалить 2 сообщения?')).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new Set(requests[0].messageIds)).toEqual(new Set([messages[0].id, messages[2].id]));
    expect(requests[0].forEveryone).toBe(true);
    await waitFor(() => expect(screen.queryByText('сообщение 3')).not.toBeInTheDocument());
    expect(screen.getByText('сообщение 2')).toBeInTheDocument();
  });
});
