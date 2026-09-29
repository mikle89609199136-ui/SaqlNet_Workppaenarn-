import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatKeys } from '@/entities/chat';
import { makeChat, makeMessage } from '@/test/fixtures';
import { createTestQueryClient, renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { IChatDto, IMessageDto } from '@/types';

const PAGE_SIZE = 50;
const START = Date.UTC(2026, 8, 29, 9, 0);
const at = (minute: number) => new Date(START + minute * 60_000).toISOString();

/** Переписка: сообщения по минуте, чужие — от собеседника. */
function history(chat: IChatDto, count: number, fromMinute = 0): IMessageDto[] {
  return Array.from({ length: count }, (_, index) =>
    makeMessage({
      chatId: chat.id,
      senderId: 'user-2',
      content: `${chat.id}: [${fromMinute + index + 1}]`,
      createdAt: at(fromMinute + index + 1),
    } as never)
  );
}

/** Сервер отвечает на отметку прочтения своей новой отметкой. */
function answerReadWith(lastReadAt: string) {
  server.use(
    http.post(api('/messages/read'), async ({ request }) => {
      const body = (await request.json()) as { messageIds?: string[] };
      return HttpResponse.json({ readIds: body.messageIds ?? [], lastReadAt });
    })
  );
}

const divider = () => screen.queryByText('Новые сообщения');

/** Разделитель стоит прямо перед этим сообщением. */
function expectDividerBefore(content: string) {
  const bubbles = screen.getAllByRole('article');
  const target = bubbles.findIndex((bubble) => bubble.textContent?.includes(content));
  expect(target).toBeGreaterThan(-1);
  const line = divider();
  expect(line).not.toBeNull();
  expect(line!.compareDocumentPosition(bubbles[target]) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  );
  if (target > 0) {
    expect(
      line!.compareDocumentPosition(bubbles[target - 1]) & Node.DOCUMENT_POSITION_PRECEDING
    ).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  }
}

describe('чат открывается на первом непрочитанном (#839)', () => {
  /* У jsdom нет раскладки: лента нулевой высоты, и виртуальный список
     рисует лишь первые строки. Высокая лента — чтобы в DOM была вся. */
  beforeEach(() => {
    const original = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      if (this.classList.contains('thread-messages')) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 800,
          bottom: 20000,
          width: 800,
          height: 20000,
          toJSON() {},
        } as DOMRect;
      }
      return original.call(this);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('три непрочитанных — «Новые сообщения» перед первым из них', async () => {
    const chat = makeChat({ type: 'private', lastReadAt: at(5), unreadCount: 3 } as never);
    const messages = history(chat, 8);

    renderChatThread({ chat, messages });

    await screen.findByText(`${chat.id}: [8]`);
    expectDividerBefore(`${chat.id}: [6]`);
  });

  it('без непрочитанных разделителя нет', async () => {
    const chat = makeChat({ type: 'private', lastReadAt: at(8), unreadCount: 0 } as never);

    renderChatThread({ chat, messages: history(chat, 8) });

    await screen.findByText(`${chat.id}: [8]`);
    expect(divider()).toBeNull();
  });

  it('первое непрочитанное старше первой страницы — история догружается до него', async () => {
    // 70 сообщений, прочитано 10: непрочитанных 60, в первой странице — 50.
    const chat = makeChat({ type: 'private', lastReadAt: at(10), unreadCount: 60 } as never);
    const all = history(chat, 70);
    const offsets: string[] = [];
    server.use(
      http.get(api(`/messages/${chat.id}`), ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'));
        offsets.push(String(offset));
        return HttpResponse.json({ messages: all.slice(0, all.length - offset).slice(-PAGE_SIZE) });
      })
    );

    renderChatThread({ chat, messages: all.slice(-PAGE_SIZE) });

    await waitFor(() => expect(divider()).not.toBeNull());
    expect(offsets).toEqual(['50']);
    expectDividerBefore(`${chat.id}: [11]`);
  });

  it('прочитанное записывается в чат: при возврате оно уже не новое', async () => {
    const chat = makeChat({ type: 'private', lastReadAt: at(5), unreadCount: 3 } as never);
    const other = makeChat({ type: 'private', lastReadAt: at(3), unreadCount: 0 } as never);
    answerReadWith(at(8));

    const queryClient = createTestQueryClient();
    queryClient.setQueryData(chatKeys.detail(other.id), other);
    queryClient.setQueryData(chatKeys.messages(other.id), {
      pages: [history(other, 3)],
      pageParams: [0],
    });
    const { router } = renderChatThread({ chat, messages: history(chat, 8), queryClient });

    await screen.findByText(`${chat.id}: [8]`);
    expect(divider()).not.toBeNull();
    await waitFor(() =>
      expect(queryClient.getQueryData<IChatDto>(chatKeys.detail(chat.id))?.lastReadAt).toBe(at(8))
    );

    // В другой чат без перезагрузки: свой снимок, своего разделителя нет.
    await act(() => router.navigate(`/chats/${other.id}`));
    await screen.findByText(`${other.id}: [3]`);
    expect(divider()).toBeNull();

    // Обратно: прочитанное при первом открытии новым не стало.
    await act(() => router.navigate(`/chats/${chat.id}`));
    await screen.findByText(`${chat.id}: [8]`);
    expect(divider()).toBeNull();
  });
});
