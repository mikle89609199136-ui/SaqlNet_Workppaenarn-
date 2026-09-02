import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { WS_EVENTS } from '@/consts';
import { eventBus } from '@/core/EventBus';
import { makeChatScenario, makeMessage, makePin } from '@/test/fixtures';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { fakeSocket } from './fakeSocket';
import { renderChatThread } from './renderChatThread';

describe('фикстуры', () => {
  it('should give the pin a different id from its message', () => {
    // В коде есть места, где id закрепления сравнивается с id сообщения.
    // При совпадающих значениях такая ошибка была бы невидима в тестах.
    const pin = makePin();

    expect(pin.id).not.toBe(pin.messageId);
    expect(pin.messageId).toBe(pin.message.id);
  });

  it('should produce messages in chronological order', () => {
    const first = makeMessage();
    const second = makeMessage();

    expect(new Date(second.createdAt).getTime()).toBeGreaterThan(
      new Date(first.createdAt).getTime()
    );
  });

  it('should build a chat whose messages belong to it', () => {
    const { chat, messages, pins } = makeChatScenario({ messages: 3, pinned: 1 });

    expect(messages).toHaveLength(3);
    expect(messages.every((message) => message.chatId === chat.id)).toBe(true);
    expect(pins[0].messageId).toBe(messages[0].id);
  });
});

describe('доставка серверных событий', () => {
  it('should deliver an event through the real message parsing', () => {
    let received: unknown = null;
    eventBus.on(WS_EVENTS.MESSAGE.NEW, (payload) => {
      received = payload;
    });

    fakeSocket.emit('new_message', { chatId: 'chat-1', message: { id: 'm-1' } });

    expect(received).toEqual({ chatId: 'chat-1', message: { id: 'm-1' } });
  });

  it('should survive a message that is not json', () => {
    expect(() => fakeSocket.emitRaw('не json')).not.toThrow();
  });
});

describe('рендер страницы чата', () => {
  it('should show the chat title and its messages', async () => {
    const { chat, messages } = makeChatScenario({ messages: 2 });

    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.post(api('/messages/read'), () => HttpResponse.json({ success: true }))
    );

    renderChatThread({ chat, messages });

    expect(await screen.findByText(chat.title)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('сообщение 1')).toBeInTheDocument();
      expect(screen.getByText('сообщение 2')).toBeInTheDocument();
    });
  });

  it('should show the empty state without messages', async () => {
    const { chat } = makeChatScenario({ messages: 0 });

    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [] })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] }))
    );

    renderChatThread({ chat, messages: [] });

    expect(await screen.findByText(/Сообщений пока нет/i)).toBeInTheDocument();
  });
});
