import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/consts';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { secretText } from '@/test/msw/plaintextGuard';

// ── Окружение, без которого правка не доходит до сервера ─────────────────────

/**
 * Ключевая пара живёт в IndexedDB, а её владелец определяется по записи
 * пользователя в localStorage. В jsdom нет ни того, ни другого: без них
 * правка обрывается на шифровании и никакого PUT не случается.
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

  globalThis.indexedDB = { open: () => settle(database) } as unknown as IDBFactory;
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

// ── Наблюдение за правкой ────────────────────────────────────────────────────

interface IEditRequest {
  method: string;
  path: string;
  content: string;
}

let peerPublicKey = '';

const ORIGINAL_TEXT = 'старый текст';

/**
 * Приватный чат с одним моим сообщением и перехватом PUT /messages/:messageId.
 * Сервер отвечает тем, что получил: настоящий бэкенд хранит шифртекст
 * и не знает открытого текста.
 */
function setupChat() {
  const me = makeUser({ id: 'user-1', firstName: 'Я' });
  const chat = makeChat({ ownerId: 'user-1', peerId: 'user-2', peerPublicKey });
  const mine = makeMessage({ chatId: chat.id, senderId: me.id, content: ORIGINAL_TEXT });
  const editRequests: IEditRequest[] = [];

  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [mine] })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
    http.put(api(`/messages/${mine.id}`), async ({ request }) => {
      const body = (await request.json()) as { content: string };
      editRequests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        content: body.content,
      });

      return HttpResponse.json({ ...mine, content: body.content, isEdited: true });
    })
  );

  renderChatThread({ chat, messages: [mine], currentUser: me });

  return { chat, mine, editRequests };
}

/** Правый клик по пузырю и выбор «Изменить» в меню действий. */
async function chooseEditAction(user: ReturnType<typeof userEvent.setup>) {
  await user.pointer({ keys: '[MouseRight]', target: await screen.findByText(ORIGINAL_TEXT) });
  await user.click(await screen.findByRole('button', { name: 'Изменить' }));

  return screen.getByLabelText('Сообщение');
}

async function replaceDraftAndSubmit(user: ReturnType<typeof userEvent.setup>, text: string) {
  const draft = await chooseEditAction(user);

  await user.clear(draft);
  await user.type(draft, text);
  await user.keyboard('{Enter}');

  return draft;
}

describe('редактирование своего сообщения', () => {
  beforeAll(async () => {
    installMemoryIndexedDB();
    peerPublicKey = await makePeerPublicKey();
  });

  beforeEach(() => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 'user-1', username: 'tester' }));
  });

  it('should open the composer with the original text after choosing edit', async () => {
    const user = userEvent.setup();
    setupChat();

    const draft = await chooseEditAction(user);

    expect(screen.getByText('Редактирование')).toBeInTheDocument();
    expect(draft).toHaveValue(ORIGINAL_TEXT);
  });

  it('should put the new text to the message endpoint', async () => {
    const user = userEvent.setup();
    const { mine, editRequests } = setupChat();
    const text = secretText('новый текст');

    await replaceDraftAndSubmit(user, text);

    await waitFor(() => expect(editRequests).toHaveLength(1));

    expect(editRequests[0].method).toBe('PUT');
    expect(editRequests[0].path).toBe(`/api/v2/messages/${mine.id}`);
    // Тело правки — такой же шифртекст, как у отправки: сервер не должен
    // получить новый текст, даже когда старый он уже хранит.
    expect(editRequests[0].content).not.toContain(text);
  });

  it('should show the new text with the edited mark', async () => {
    const user = userEvent.setup();
    const { editRequests } = setupChat();
    const text = secretText('новый текст');

    const draft = await replaceDraftAndSubmit(user, text);

    await waitFor(() => expect(editRequests).toHaveLength(1));

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText('изменено')).toBeInTheDocument();
    expect(screen.queryByText(ORIGINAL_TEXT)).not.toBeInTheDocument();
    // Композер выходит из режима правки — иначе следующий Enter снова
    // отредактировал бы то же сообщение.
    expect(screen.queryByText('Редактирование')).not.toBeInTheDocument();
    expect(draft).toHaveValue('');
  });
});
