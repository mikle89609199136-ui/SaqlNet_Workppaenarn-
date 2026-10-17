import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatKeys } from '@/entities/chat';
import { addOutboxItem, clearOutbox } from '@/entities/message';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { makeChat, makeMessage, makeUser, resetFixtures } from '@/test/fixtures';
import { createTestQueryClient, renderChatThread } from '@/test/harness/renderChatThread';
import { mockThreadLayout, setPageActive } from '@/test/harness/threadLayout';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { IChatDto, IMessageDto } from '@/types';

const ME = 'user-1';
const PEER = 'user-2';
const START = Date.UTC(2026, 8, 29, 9, 0);
const at = (minute: number) => new Date(START + minute * 60_000).toISOString();

let readRequests: string[][];

function history(chat: IChatDto, count: number): IMessageDto[] {
  return Array.from({ length: count }, (_, index) =>
    makeMessage({
      chatId: chat.id,
      senderId: PEER,
      content: `[${index + 1}]`,
      createdAt: at(index + 1),
    } as never)
  );
}

function answerRead(messages: IMessageDto[]) {
  const createdAt = new Map(messages.map((message) => [message.id, String(message.createdAt)]));
  server.use(
    http.post(api('/messages/read'), async ({ request }) => {
      const { messageIds } = (await request.json()) as { messageIds: string[] };
      readRequests.push(messageIds);
      const lastReadAt = messageIds
        .map((id) => createdAt.get(id) ?? '')
        .sort()
        .at(-1);
      return HttpResponse.json({ readIds: messageIds, lastReadAt });
    })
  );
}

function open(chat: IChatDto, messages: IMessageDto[]) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(chatKeys.list(), [chat]);
  answerRead(messages);
  renderChatThread({ chat, messages, queryClient, currentUser: makeUser({ id: ME }) });
  const listed = () =>
    queryClient.getQueryData<IChatDto[]>(chatKeys.list())?.find((item) => item.id === chat.id);
  return { listed };
}

const contentOf = (messages: IMessageDto[], ids: string[]) =>
  ids.map((id) => messages.find((message) => message.id === id)?.content);

describe('отметка прочтения по мере показа на экране (#919)', () => {
  beforeEach(() => {
    resetFixtures();
    readRequests = [];
    setPageActive();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPageActive();
  });

  it('открыл чат с 30 непрочитанными — прочитаны только показанные, счётчик уменьшился на них', async () => {
    mockThreadLayout({ viewport: 1000, row: 100 });
    const chat = makeChat({ type: 'private', lastReadAt: at(10), unreadCount: 30 } as never);
    const messages = history(chat, 40);
    const { listed } = open(chat, messages);

    await waitFor(() => expect(readRequests).toHaveLength(1));
    const [seen] = readRequests;

    expect(contentOf(messages, seen)).toEqual(
      Array.from({ length: seen.length }, (_, index) => `[${index + 11}]`)
    );
    expect(seen.length).toBeLessThan(30);
    await waitFor(() => expect(listed()?.unreadCount).toBe(30 - seen.length));
  });

  it('долистал до конца — непрочитанных 0', async () => {
    mockThreadLayout({ viewport: 1000, row: 100 });
    const chat = makeChat({ type: 'private', lastReadAt: at(10), unreadCount: 30 } as never);
    const messages = history(chat, 40);
    const { listed } = open(chat, messages);
    await waitFor(() => expect(readRequests).toHaveLength(1));

    const feed = document.querySelector('.thread-messages')!;
    Object.defineProperty(feed, 'scrollTop', { configurable: true, value: 100_000 });
    fireEvent.scroll(feed);

    await waitFor(() => expect(listed()?.unreadCount).toBe(0));
    expect(readRequests.flat()).toHaveLength(30);
  });

  it('повторный показ того же сообщения второго запроса не даёт', async () => {
    mockThreadLayout({ viewport: 20_000 });
    const chat = makeChat({ type: 'private', lastReadAt: at(2), unreadCount: 3 } as never);
    const messages = history(chat, 5);
    open(chat, messages);
    await waitFor(() => expect(readRequests).toHaveLength(1));

    const feed = document.querySelector('.thread-messages')!;
    fireEvent.scroll(feed);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(readRequests).toHaveLength(1);
    expect(contentOf(messages, readRequests[0])).toEqual(['[3]', '[4]', '[5]']);
  });

  it('вкладка в фоне — новое входящее не отмечается, пока вкладку не открыли', async () => {
    mockThreadLayout({ viewport: 20_000 });
    const chat = makeChat({ type: 'private', lastReadAt: at(3), unreadCount: 0 } as never);
    const messages = history(chat, 3);
    open(chat, messages);
    await screen.findByText('[3]');

    setPageActive({ visible: false });
    const incoming = makeMessage({
      chatId: chat.id,
      senderId: PEER,
      content: 'пришло в фоне',
      createdAt: at(4),
    } as never);
    answerRead([...messages, incoming]);
    await act(async () => {
      fakeSocket.emit('new_message', { chatId: chat.id, message: incoming });
    });
    await screen.findByText('пришло в фоне');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(readRequests).toEqual([]);

    act(() => setPageActive());

    await waitFor(() => expect(readRequests).toEqual([[incoming.id]]));
  });

  it('окно без фокуса — новое входящее не отмечается, пока в окно не вернулись', async () => {
    mockThreadLayout({ viewport: 20_000 });
    const chat = makeChat({ type: 'private', lastReadAt: at(3), unreadCount: 0 } as never);
    const messages = history(chat, 3);
    open(chat, messages);
    await screen.findByText('[3]');

    setPageActive({ focused: false });
    const incoming = makeMessage({
      chatId: chat.id,
      senderId: PEER,
      content: 'пришло без фокуса',
      createdAt: at(4),
    } as never);
    answerRead([...messages, incoming]);
    await act(async () => {
      fakeSocket.emit('new_message', { chatId: chat.id, message: incoming });
    });
    await screen.findByText('пришло без фокуса');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(readRequests).toEqual([]);

    act(() => setPageActive());

    await waitFor(() => expect(readRequests).toEqual([[incoming.id]]));
  });
});

/* Неотправленное сообщение лежит в очереди, сервер его не знает (#1067).
   Его временный id в отметке прочтения давал 400 на всю пачку, и
   входящие рядом с ним не отмечались. А восстановленное из очереди без
   автора рисовалось чужим, без «Повторить». */
describe('неотправленное сообщение и отметка прочтения (#1067)', () => {
  beforeEach(() => {
    resetFixtures();
    readRequests = [];
    setPageActive();
    clearOutbox();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPageActive();
    clearOutbox();
  });

  it('в отметку уходят только подтверждённые, а неотправленное остаётся своим', async () => {
    mockThreadLayout({ viewport: 2000, row: 100 });
    const chat = makeChat({ type: 'private', lastReadAt: at(0), unreadCount: 2 } as never);
    const messages = history(chat, 2);
    addOutboxItem({
      tempId: 'temp-unsent',
      chatId: chat.id,
      senderId: ME,
      content: 'не ушло',
      type: 'text',
      status: 'failed',
      createdAt: new Date(at(3)),
    });
    open(chat, messages);

    await waitFor(() => expect(readRequests.length).toBeGreaterThan(0));
    expect(readRequests.flat().filter((id) => id.startsWith('temp-'))).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Повторить отправку' })).toBeInTheDocument();

    const incoming = makeMessage({
      chatId: chat.id,
      senderId: PEER,
      content: '[новое]',
      createdAt: at(4),
    } as never);
    act(() => {
      fakeSocket.emit('new_message', { chatId: chat.id, message: incoming });
    });

    await waitFor(() => expect(readRequests.flat()).toContain(incoming.id));
    expect(readRequests.flat().filter((id) => id.startsWith('temp-'))).toEqual([]);
  });
});
