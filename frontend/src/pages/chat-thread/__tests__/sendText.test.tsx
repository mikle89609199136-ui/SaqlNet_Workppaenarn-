import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config';
import type { IChatDto } from '@/types';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { secretText } from '@/test/msw/plaintextGuard';
import { stubCrypto } from '@/test/harness/stubCrypto';
import { typeIntoComposer } from '@/test/harness/composer';
import type { IRichText } from '@/shared/lib/richText';

// ── Наблюдение за отправкой ──────────────────────────────────────────────────

interface ISendRequestBody {
  content: string;
  type: string;
  replyTo: string | null;
  entities?: unknown[];
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
    // Отправка — всегда пачкой (#808): каждое сообщение пачки — отдельное тело.
    http.post(api(`/messages/${chat.id}`), async ({ request }) => {
      const { messages } = (await request.json()) as { messages: ISendRequestBody[] };
      sentBodies.push(...messages);

      return HttpResponse.json({
        messages: messages.map((item) =>
          makeMessage({ chatId: chat.id, senderId: me.id, content: item.content })
        ),
      });
    })
  );

  return { me, chat, sentBodies };
}

async function typeAndPressEnter(text: string | IRichText) {
  const user = userEvent.setup();
  const input = await screen.findByRole('textbox', { name: 'Сообщение' });

  await user.click(input);
  await typeIntoComposer(input, text);
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

    expect(input.textContent).toBe('');
  });

  it('форматирование уходит внутри шифртекста и видно в ленте (#656)', async () => {
    const { me, chat, sentBodies } = setupChat();
    const text = secretText('важное');

    renderChatThread({ chat, messages: [], currentUser: me });
    await typeAndPressEnter({ text, entities: [{ type: 'bold', offset: 0, length: text.length }] });

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    expect(sentBodies[0]).not.toHaveProperty('entities');
    expect(sentBodies[0].content).not.toContain(text);

    await waitFor(() => expect(screen.getByText(text)).toHaveClass('font-semibold'));
  });

  it('should not let the message be typed while the chat key is not ready', async () => {
    // Пока ключа чата нет, шифровать нечем. Отправить открытым текстом
    // хуже, чем не отправить, поэтому вместо поля ввода — плашка, почему
    // писать нельзя, и «Проверить» (#826).
    const { me, chat, sentBodies } = setupChat();

    renderChatThread({ chat, messages: [], currentUser: me, keyUnavailable: true });

    expect(await screen.findByText('Шифрование недоступно.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Сообщение' })).not.toBeInTheDocument();
    expect(sentBodies).toHaveLength(0);
  });
});
