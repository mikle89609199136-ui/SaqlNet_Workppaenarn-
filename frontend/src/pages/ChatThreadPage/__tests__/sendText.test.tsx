import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/consts';
import type { IChatDto } from '@/types';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { secretText } from '@/test/msw/plaintextGuard';
import { stubCrypto } from '@/test/harness/stubCrypto';

// ── Наблюдение за отправкой ──────────────────────────────────────────────────

interface ISendRequestBody {
  content: string;
  type: string;
  replyTo: string | null;
}

/**
 * Приватный чат и перехват POST /messages/:chatId. Сервер отвечает тем,
 * что получил: настоящий бэкенд хранит шифртекст и не знает открытого
 * текста.
 */
function setupChat(overrides: Partial<IChatDto> = {}) {
  const me = makeUser({ id: 'user-1', firstName: 'Я' });
  const chat = makeChat({ ownerId: me.id, peerId: 'user-2', ...overrides });
  const sentBodies: ISendRequestBody[] = [];

  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [] })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
    http.post(api(`/messages/${chat.id}`), async ({ request }) => {
      const body = (await request.json()) as ISendRequestBody;
      sentBodies.push(body);

      return HttpResponse.json({
        message: makeMessage({ chatId: chat.id, senderId: me.id, content: body.content }),
      });
    })
  );

  return { me, chat, sentBodies };
}

async function typeAndPressEnter(text: string) {
  const user = userEvent.setup();
  const input = await screen.findByPlaceholderText('Сообщение...');

  await user.type(input, text);
  await user.keyboard('{Enter}');

  return input;
}

describe('отправка текста', () => {
  beforeEach(() => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 'user-1', username: 'tester' }));
    stubCrypto();
  });

  it('should not put the typed text into the request body', async () => {
    const { me, chat, sentBodies } = setupChat();
    const text = secretText('открытый текст');

    renderChatThread({ chat, messages: [], currentUser: me });
    await typeAndPressEnter(text);

    await waitFor(() => expect(sentBodies).toHaveLength(1));

    expect(sentBodies[0].type).toBe('text');
    expect(sentBodies[0].content).not.toBe(text);
    expect(sentBodies[0].content).not.toContain(text);
  });

  it('should show the typed text in the thread exactly once', async () => {
    const { me, chat, sentBodies } = setupChat();
    const text = secretText('открытый текст');

    renderChatThread({ chat, messages: [], currentUser: me });
    const input = await typeAndPressEnter(text);

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByText(text)).toHaveLength(1));

    expect(input).toHaveValue('');
  });

  it('should not let the message be typed while the chat key is not ready', async () => {
    // Пока ключа чата нет, шифровать нечем. Отправить открытым текстом
    // хуже, чем не отправить, поэтому поле ввода закрыто, и человек видит
    // почему.
    const { me, chat, sentBodies } = setupChat();

    renderChatThread({ chat, messages: [], currentUser: me, keyUnavailable: true });

    const input = await screen.findByPlaceholderText('Шифрование недоступно');

    expect(input).toBeDisabled();
    expect(sentBodies).toHaveLength(0);
  });
});
