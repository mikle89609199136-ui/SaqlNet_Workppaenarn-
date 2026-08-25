import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/consts';
import type { IChatDto } from '@/types';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { secretText } from '@/test/msw/plaintextGuard';

// ── Окружение, без которого шифрование не запускается ────────────────────────

/**
 * Ключевая пара живёт в IndexedDB, а её владелец определяется по записи
 * пользователя в localStorage. В jsdom нет ни того, ни другого: без них
 * отправка обрывается ещё до запроса, и проверять в теле было бы нечего.
 * Хранилище общее на файл — так же, как настоящее переживает перезагрузку.
 */
const keyStorage = new Map<string, unknown>();

function installMemoryIndexedDB(): void {
  if (globalThis.indexedDB) return;

  const settle = <T,>(result: T) => {
    const request: Record<string, unknown> = { result, onsuccess: null, onerror: null };
    queueMicrotask(() =>
      (request.onsuccess as ((e: unknown) => void) | null)?.({ target: request })
    );
    return request;
  };

  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: () => ({
      objectStore: () => ({
        get: (key: string) => settle(keyStorage.get(key)),
        put: (value: unknown, key: string) => {
          keyStorage.set(key, value);
          return settle(undefined);
        },
      }),
    }),
  };

  globalThis.indexedDB = {
    open: () => settle(database),
  } as unknown as IDBFactory;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Настоящий публичный ключ собеседника: подделка не пройдёт importKey. */
async function makePeerPublicKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ]);

  return toBase64(await crypto.subtle.exportKey('spki', pair.publicKey));
}

// ── Наблюдение за отправкой ──────────────────────────────────────────────────

interface ISendRequestBody {
  content: string;
  type: string;
  replyTo: string | null;
}

let peerPublicKey = '';

/**
 * Приватный чат с ключом собеседника и перехватом POST /messages/:chatId.
 * Сервер отвечает тем, что получил: настоящий бэкенд хранит шифртекст
 * и не знает открытого текста.
 */
function setupChat(overrides: Partial<IChatDto> = {}) {
  const me = makeUser({ id: 'user-1', firstName: 'Я' });
  const chat = makeChat({ ownerId: me.id, peerId: 'user-2', peerPublicKey, ...overrides });
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
  beforeAll(async () => {
    installMemoryIndexedDB();
    peerPublicKey = await makePeerPublicKey();
  });

  beforeEach(() => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 'user-1', username: 'tester' }));
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

  it('should send nothing when the chat has no peer key', async () => {
    // Ключ собеседника — единственное, из чего собирается шифртекст.
    // Без него отправлять нечего, кроме открытого текста, — значит нельзя
    // отправлять вовсе.
    const { me, chat, sentBodies } = setupChat({ peerPublicKey: undefined });
    const text = secretText('открытый текст');

    renderChatThread({ chat, messages: [], currentUser: me });
    await typeAndPressEnter(text);

    expect(
      await screen.findByText('У собеседника нет ключа шифрования — сообщение не отправлено')
    ).toBeInTheDocument();
    expect(sentBodies).toHaveLength(0);
  });
});
