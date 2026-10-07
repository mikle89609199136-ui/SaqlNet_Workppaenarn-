import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { stubCrypto } from '@/test/harness/stubCrypto';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { typeIntoComposer } from '@/test/harness/composer';

describe('отказ при отправке сообщения', () => {
  function setup(code: string, message: string) {
    stubCrypto();

    const currentUser = makeUser({ id: 'user-1' });
    const chat = makeChat({ id: 'chat-send-error' });
    const existing = makeMessage({
      chatId: chat.id,
      senderId: 'user-2',
      content: 'уже написанное сообщение',
    });

    server.use(
      http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
      http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages: [existing] })),
      http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] })),
      http.post(api(`/messages/${chat.id}`), () =>
        HttpResponse.json({ code, message }, { status: 403 })
      )
    );

    renderChatThread({ chat, messages: [existing], currentUser });
    return { chat };
  }

  async function отправить(текст: string) {
    const поле = await screen.findByRole('textbox', { name: 'Сообщение' });
    await typeIntoComposer(поле, текст);
    await userEvent.click(screen.getByRole('button', { name: /Отправить/i }));
  }

  it('объясняет отказ по-русски, а не строкой сервера', async () => {
    /* Сервер отвечает «member is muted» — текстом для разработчика.
       Раньше он и показывался человеку. */
    setup('member_muted', 'member is muted');

    await отправить('привет');

    expect(await screen.findByRole('alert')).toHaveTextContent('В этом чате вам запрещено писать');
    expect(screen.queryByText(/member is muted/i)).toBeNull();
  });

  it('показывает отказ в чате с историей, а не только в пустом', async () => {
    /* Плашка жила в ленте и рисовалась при нулевом числе сообщений:
       в переписке с историей отправка молча не удавалась. */
    setup('member_muted', 'member is muted');

    await отправить('привет');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('уже написанное сообщение')).toBeInTheDocument();
  });

  it('на незнакомый код говорит своими словами', async () => {
    /* Незнакомый код пишется в консоль — это и есть способ узнать, что
       перевод пора добавить. Здесь предупреждение ожидаемо, поэтому
       страж подменяется: иначе он превратит его в падение. */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    setup('some_unknown_code', 'unexpected server failure');

    await отправить('привет');

    const плашка = await screen.findByRole('alert');
    expect(плашка).toHaveTextContent('Не удалось отправить сообщение');
    expect(плашка).not.toHaveTextContent('unexpected');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('some_unknown_code'));

    warn.mockRestore();
  });
});
