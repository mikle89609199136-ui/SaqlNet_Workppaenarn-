import { screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { makeChatScenario, makeMessage } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

const PAGE_SIZE = 50;

/**
 * «Перейти к сообщению» из общего в профиле (#842). Профиль — не часть
 * ленты: он оставляет запрос в сторе, лента открытого чата его выполняет.
 */
describe('переход к сообщению из профиля', () => {
  afterEach(() => {
    useChatUiStore.setState({ jumpRequest: null, highlightedMessageId: null });
  });

  it('сообщение уже в ленте — подсвечивается, запрос снимается', async () => {
    const { chat, messages } = makeChatScenario({ messages: 3 });
    renderChatThread({ chat, messages });
    await screen.findByText('сообщение 1');

    useChatUiStore.getState().setJumpRequest({ chatId: chat.id, messageId: messages[0].id });

    await waitFor(() =>
      expect(useChatUiStore.getState().highlightedMessageId).toBe(messages[0].id)
    );
    expect(useChatUiStore.getState().jumpRequest).toBeNull();
  });

  it('запрос к другому чату лента не трогает', async () => {
    const { chat, messages } = makeChatScenario({ messages: 3 });
    renderChatThread({ chat, messages });
    await screen.findByText('сообщение 1');

    const request = { chatId: 'other-chat', messageId: messages[0].id };
    useChatUiStore.getState().setJumpRequest(request);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useChatUiStore.getState().jumpRequest).toEqual(request);
    expect(useChatUiStore.getState().highlightedMessageId).toBeNull();
  });

  it('старое сообщение — лента догружается до него по позиции', async () => {
    const { chat, messages } = makeChatScenario({ messages: PAGE_SIZE });
    const firstShownAt = new Date(messages[0].createdAt).getTime();
    // Шесть страниц истории выше показанной; нужное — на последней.
    const older = Array.from({ length: PAGE_SIZE * 6 }, (_, index) =>
      makeMessage({
        chatId: chat.id,
        content: `старое ${index + 1}`,
        createdAt: new Date(firstShownAt - (PAGE_SIZE * 6 - index) * 60_000),
      })
    );
    const target = older[0];
    const offsets: string[] = [];

    server.use(
      http.get(api(`/messages/${chat.id}`), ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'));
        offsets.push(String(offset));
        // Страница N выше показанной — N-я с конца старых.
        const end = older.length - (offset - PAGE_SIZE);
        return HttpResponse.json({ messages: older.slice(Math.max(0, end - PAGE_SIZE), end) });
      }),
      http.get(api(`/chats/${chat.id}/messages/${target.id}/position`), () =>
        HttpResponse.json({ position: PAGE_SIZE * 7 - 1 })
      )
    );

    renderChatThread({ chat, messages });
    await screen.findByText('сообщение 1');

    useChatUiStore.getState().setJumpRequest({ chatId: chat.id, messageId: target.id });

    await waitFor(() => expect(useChatUiStore.getState().highlightedMessageId).toBe(target.id), {
      timeout: 5000,
    });
    // Раньше лента бросала поиск после пяти страниц.
    expect(offsets.length).toBe(6);
  });
});

/* Переход в другой чат держался на том, что его история уже в кеше: лента
   снимала запрос, пока ещё грузилась, а смена чата его сбрасывала (#1076). */
describe('переход к сообщению другого чата', () => {
  afterEach(() => {
    useChatUiStore.setState({ jumpRequest: null, highlightedMessageId: null });
  });

  function serveChat(chat: { id: string }, messages: unknown[], wait = 0) {
    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.get(api(`/messages/${chat.id}`), async () => {
        if (wait) await delay(wait);
        return HttpResponse.json({ messages });
      })
    );
  }

  it('лента нового чата ещё грузится — переход выполняется после загрузки', async () => {
    const a = makeChatScenario({ messages: 1 });
    const b = makeChatScenario({ messages: 3 });
    serveChat(b.chat, b.messages, 100);
    const { router } = renderChatThread({ chat: a.chat, messages: a.messages });
    await screen.findByText('сообщение 1');

    useChatUiStore.getState().setJumpRequest({ chatId: b.chat.id, messageId: b.messages[0].id });
    await router.navigate(`/chats/${b.chat.id}`);

    await waitFor(() =>
      expect(useChatUiStore.getState().highlightedMessageId).toBe(b.messages[0].id)
    );
    expect(screen.queryByText(/выше в истории/)).toBeNull();
  });

  it('запрос к одному чату, а переход в другой — запрос сброшен', async () => {
    const a = makeChatScenario({ messages: 1 });
    const b = makeChatScenario({ messages: 1 });
    const c = makeChatScenario({ messages: 1 });
    serveChat(c.chat, c.messages);
    const { router } = renderChatThread({ chat: a.chat, messages: a.messages });
    await screen.findByText('сообщение 1');

    useChatUiStore.getState().setJumpRequest({ chatId: b.chat.id, messageId: b.messages[0].id });
    await router.navigate(`/chats/${c.chat.id}`);

    await waitFor(() => expect(useChatUiStore.getState().jumpRequest).toBeNull());
    expect(useChatUiStore.getState().highlightedMessageId).toBeNull();
  });
});
