import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { clearToasts, getToasts } from '@/shared/ui';
import { makeChatScenario, makeMessage } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

/**
 * Из «Избранного» к исходному сообщению (#1076). Чат оригинала клиенту
 * неизвестен — его подсказывает сервер, а переход идёт тем же запросом,
 * что из общего в профиле.
 */

const GO = 'Перейти к исходному сообщению';

function forwarded(chatId: string, metadata: Record<string, unknown>) {
  return makeMessage({
    id: 'm-saved',
    chatId,
    content: 'пересланное',
    isForwarded: true,
    forwardedSenderName: 'Анна',
    forwardedSenderId: 'user-anna',
    metadata: { forwardedSenderName: 'Анна', ...metadata },
  } as never);
}

function savedChatWith(message: ReturnType<typeof makeMessage>) {
  const saved = makeChatScenario({
    messages: 0,
    chat: { type: 'self', peerId: undefined, title: 'Избранное' } as never,
  });
  const messages = [{ ...message, chatId: saved.chat.id }];
  server.use(
    http.get(api(`/chats/${saved.chat.id}`), () => HttpResponse.json({ chat: saved.chat })),
    http.get(api(`/chats/${saved.chat.id}/pins`), () => HttpResponse.json({ pins: [] }))
  );
  return { chat: saved.chat, messages };
}

afterEach(() => {
  useChatUiStore.setState({ jumpRequest: null, highlightedMessageId: null });
  clearToasts();
});

describe('к исходному сообщению из «Избранного»', () => {
  it('открывает чат оригинала и подсвечивает его', async () => {
    const origin = makeChatScenario({ messages: 3 });
    const target = origin.messages[0];
    let locationRequests = 0;
    server.use(
      http.get(api(`/messages/${target.id}/location`), () => {
        locationRequests += 1;
        return HttpResponse.json({ chatId: origin.chat.id });
      }),
      http.get(api(`/chats/${origin.chat.id}`), () => HttpResponse.json({ chat: origin.chat })),
      http.get(api(`/chats/${origin.chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.get(api(`/messages/${origin.chat.id}`), () =>
        HttpResponse.json({ messages: origin.messages })
      )
    );
    const { chat, messages } = savedChatWith(forwarded('', { forwardedFrom: target.id }));
    const { router } = renderChatThread({ chat, messages });

    await userEvent.click(await screen.findByRole('button', { name: GO }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/chats/${origin.chat.id}`));
    await waitFor(() => expect(useChatUiStore.getState().highlightedMessageId).toBe(target.id));
    expect(locationRequests).toBe(1);
  });

  it('оригинал удалён или недоступен — подсказка, остаёмся в «Избранном»', async () => {
    server.use(
      http.get(api('/messages/m-gone/location'), () =>
        HttpResponse.json({ code: 'message_not_found' }, { status: 404 })
      )
    );
    const { chat, messages } = savedChatWith(forwarded('', { forwardedFrom: 'm-gone' }));
    const { router } = renderChatThread({ chat, messages });

    await userEvent.click(await screen.findByRole('button', { name: GO }));

    await waitFor(() =>
      expect(getToasts()).toEqual([
        expect.objectContaining({ message: 'Исходное сообщение удалено или недоступно' }),
      ])
    );
    expect(router.state.location.pathname).toBe(`/chats/${chat.id}`);
  });

  it('сервер упал — своя подсказка', async () => {
    server.use(
      http.get(api('/messages/m-broken/location'), () => HttpResponse.json({}, { status: 500 }))
    );
    const { chat, messages } = savedChatWith(forwarded('', { forwardedFrom: 'm-broken' }));
    renderChatThread({ chat, messages });

    await userEvent.click(await screen.findByRole('button', { name: GO }));

    await waitFor(() =>
      expect(getToasts()).toEqual([
        expect.objectContaining({ message: 'Не удалось открыть исходное сообщение' }),
      ])
    );
  });

  it('двойное нажатие — один запрос', async () => {
    let requests = 0;
    server.use(
      http.get(api('/messages/m-slow/location'), async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ code: 'message_not_found' }, { status: 404 });
      })
    );
    const { chat, messages } = savedChatWith(forwarded('', { forwardedFrom: 'm-slow' }));
    renderChatThread({ chat, messages });

    const go = await screen.findByRole('button', { name: GO });
    fireEvent.click(go);
    fireEvent.click(go);

    await waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(requests).toBe(1);
  });

  it('автор скрыл ссылку на себя — кнопки нет', async () => {
    const { chat, messages } = savedChatWith(forwarded('', { forwardedHidden: true }));
    renderChatThread({ chat, messages });

    await screen.findByText('пересланное');
    expect(screen.queryByRole('button', { name: GO })).toBeNull();
  });

  it('в обычном чате строка по-прежнему ведёт в профиль автора', async () => {
    const plain = makeChatScenario({ messages: 0 });
    const message = { ...forwarded(plain.chat.id, { forwardedFrom: 'm-x' }) };
    renderChatThread({ chat: plain.chat, messages: [message] });

    await screen.findByText('пересланное');
    expect(screen.queryByRole('button', { name: GO })).toBeNull();
    expect(screen.getByRole('button', { name: 'Анна' })).toBeInTheDocument();
  });
});
