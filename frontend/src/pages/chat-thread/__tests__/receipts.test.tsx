import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { makeChat, makeMessage, makeUser, resetFixtures } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { IChatDto, IMessageDto } from '@/types';

/**
 * Доставка и прочтение своих сообщений (#657): событие `receipts` ставит
 * галочки на месте, а меню своего сообщения показывает время.
 */

const ME = 'user-1';
const PEER = 'user-2';

function mockChatHandlers(chat: IChatDto, messages: IMessageDto[]) {
  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] }))
  );
}

function setup(type: IChatDto['type'] = 'private') {
  const chat = makeChat({ id: 'chat-receipts', type, peerId: PEER });
  const mine = makeMessage({
    chatId: chat.id,
    senderId: ME,
    content: 'моё сообщение',
    createdAt: new Date('2026-09-29T12:00:00.000Z'),
  });
  mockChatHandlers(chat, [mine]);
  renderChatThread({ chat, messages: [mine], currentUser: makeUser({ id: ME }) });
  return { chat, mine };
}

describe('доставка и прочтение по сокету (#657)', () => {
  beforeEach(() => {
    resetFixtures();
  });

  it('собеседник получил, затем прочитал — галочки меняются без перезагрузки', async () => {
    const { chat } = setup();
    expect(await screen.findByRole('img', { name: 'Отправлено' })).toBeInTheDocument();

    const event = {
      type: 'receipts',
      chatId: chat.id,
      userId: PEER,
      upTo: '2026-09-29T12:00:00.000Z',
    };
    await act(async () => {
      fakeSocket.emit('receipts', { ...event, kind: 'delivered', at: '2026-09-29T12:01:00.000Z' });
    });
    expect(await screen.findByRole('img', { name: 'Доставлено' })).toBeInTheDocument();

    await act(async () => {
      fakeSocket.emit('receipts', { ...event, kind: 'read', at: '2026-09-29T12:02:00.000Z' });
    });
    expect(await screen.findByRole('img', { name: 'Прочитано' })).toBeInTheDocument();
  });

  it('граница раньше сообщения — оно остаётся отправленным', async () => {
    const { chat } = setup();
    await screen.findByRole('img', { name: 'Отправлено' });

    await act(async () => {
      fakeSocket.emit('receipts', {
        type: 'receipts',
        chatId: chat.id,
        userId: PEER,
        kind: 'read',
        upTo: '2026-09-29T11:59:59.999Z',
        at: '2026-09-29T12:02:00.000Z',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Отправлено' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('img', { name: 'Прочитано' })).not.toBeInTheDocument();
  });

  it('в меню своего прочитанного сообщения — время прочтения первой строкой', async () => {
    const { chat } = setup();
    await act(async () => {
      fakeSocket.emit('receipts', {
        type: 'receipts',
        chatId: chat.id,
        userId: PEER,
        kind: 'read',
        upTo: '2026-09-29T12:00:00.000Z',
        at: new Date().toISOString(),
      });
    });
    await screen.findByRole('img', { name: 'Прочитано' });

    fireEvent.contextMenu(screen.getByText('моё сообщение'));

    const line = await screen.findByRole('group', { name: /^Прочитано сегодня в \d\d:\d\d$/ });
    const menu = screen.getByRole('menu');
    expect(menu.firstElementChild).toBe(line);
  });

  it('у неотправленного до собеседника в меню строки времени нет', async () => {
    setup();
    await screen.findByRole('img', { name: 'Отправлено' });

    fireEvent.contextMenu(screen.getByText('моё сообщение'));

    await screen.findByRole('menu');
    expect(screen.queryByRole('group', { name: /Прочитано|Доставлено/ })).not.toBeInTheDocument();
  });
});
