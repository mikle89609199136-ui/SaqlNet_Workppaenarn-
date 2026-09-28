import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/shared/config';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { secretText } from '@/test/msw/plaintextGuard';
import { stubCrypto } from '@/test/harness/stubCrypto';
import { typeIntoComposer } from '@/test/harness/composer';

const PEER_PUBLIC_KEY = 'ключ-собеседника';

const ORIGINAL_TEXT = 'старый текст';

/**
 * Приватный чат с одним моим сообщением и перехватом PUT /messages/:messageId.
 * Сервер отвечает тем, что получил: настоящий бэкенд хранит шифртекст
 * и не знает открытого текста.
 */
function setupChat() {
  const me = makeUser({ id: 'user-1', firstName: 'Я' });
  const chat = makeChat({ ownerId: 'user-1', peerId: 'user-2', peerPublicKey: PEER_PUBLIC_KEY });
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
  await user.click(await screen.findByRole('menuitem', { name: 'Изменить' }));

  return screen.getByLabelText('Сообщение');
}

async function replaceDraftAndSubmit(user: ReturnType<typeof userEvent.setup>, text: string) {
  const draft = await chooseEditAction(user);

  await typeIntoComposer(draft, text);
  await user.keyboard('{Enter}');

  return draft;
}

describe('редактирование своего сообщения', () => {
  beforeEach(() => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 'user-1', username: 'tester' }));
    stubCrypto();
  });

  it('меню своего сообщения — по макету, «Удалить» последним (#825)', async () => {
    const user = userEvent.setup();
    setupChat();

    await user.pointer({ keys: '[MouseRight]', target: await screen.findByText(ORIGINAL_TEXT) });
    await screen.findByRole('menu', { name: 'Действия с сообщением' });

    const items = screen
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
      // Реакции — отдельный ряд над пунктами.
      .filter(Boolean);
    expect(items).toEqual([
      'Ответить',
      'Копировать',
      'Изменить',
      'Закрепить',
      'Переслать',
      'Выбрать',
      'Удалить',
    ]);
  });

  it('should open the composer with the original text after choosing edit', async () => {
    const user = userEvent.setup();
    setupChat();

    const draft = await chooseEditAction(user);

    expect(screen.getByText('Редактирование')).toBeInTheDocument();
    expect(draft.textContent).toBe(ORIGINAL_TEXT);
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
    expect(draft.textContent).toBe('');
  });
});
