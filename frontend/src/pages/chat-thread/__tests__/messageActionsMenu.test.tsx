import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeMessage, resetFixtures } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { useChatUiStore } from '@/entities/chat';
import { clearToasts, getToasts } from '@/shared/ui';
import type { IChatDto, IMessageDto, IPinnedDto } from '@/types';

/**
 * Меню действий сообщения (#655): состав по типу, автору и состоянию и
 * то, что пункты действительно делают.
 */

const ME = 'user-1';
const PEER = 'user-2';

function serveChat(chat: IChatDto, messages: IMessageDto[], pins: IPinnedDto[] = []) {
  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins }))
  );
}

function open(messages: IMessageDto[], pins: IPinnedDto[] = []) {
  const chat = makeChat({ id: 'chat-menu', type: 'private', peerId: PEER });
  const inChat = messages.map((message) => ({ ...message, chatId: chat.id }));
  serveChat(chat, inChat, pins);
  renderChatThread({ chat, messages: inChat, pins });
}

async function menuItems(anchorText: string): Promise<string[]> {
  // Закреплённое видно и в панели закрепа сверху — пузырь в ленте последний.
  fireEvent.contextMenu((await screen.findAllByText(anchorText)).at(-1)!);
  await screen.findByRole('menu');
  return screen
    .getAllByRole('menuitem')
    .map((item) => item.textContent?.trim() ?? '')
    .filter((name) => name && !/^\p{Extended_Pictographic}/u.test(name));
}

const clipboard = { writeText: vi.fn(), write: vi.fn() };

beforeEach(() => {
  resetFixtures();
  clearToasts();
  useChatUiStore.setState({ actionMenu: null, selectedMessages: [], selectionMode: false });
  clipboard.writeText.mockReset().mockResolvedValue(undefined);
  clipboard.write.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('меню действий сообщения (#655)', () => {
  it('своё текстовое: ответить, копировать, изменить, закрепить, переслать, выбрать, удалить', async () => {
    open([makeMessage({ senderId: ME, content: 'моё сообщение' })]);

    expect(await menuItems('моё сообщение')).toEqual([
      'Ответить',
      'Копировать',
      'Изменить',
      'Закрепить',
      'Переслать',
      'Выбрать',
      'Удалить',
    ]);
  });

  it('чужое текстовое: перевести вместо изменить', async () => {
    open([makeMessage({ senderId: PEER, content: 'чужое сообщение' })]);

    const items = await menuItems('чужое сообщение');
    expect(items).toContain('Перевести');
    expect(items).not.toContain('Изменить');
  });

  it('неотправленное: только копировать и удалить, без реакций', async () => {
    open([makeMessage({ senderId: ME, content: 'не ушло', status: 'failed' })]);

    expect(await menuItems('не ушло')).toEqual(['Копировать', 'Удалить']);
    expect(screen.queryByRole('group', { name: 'Реакции' })).not.toBeInTheDocument();
  });

  it('закреплённое: «Открепить» вместо «Закрепить»', async () => {
    const message = makeMessage({ senderId: ME, content: 'важное' });
    open(
      [message],
      [
        {
          id: 'pin-1',
          messageId: message.id,
          chatId: 'chat-menu',
          pinnedBy: ME,
          pinnedAt: new Date(),
          message,
        },
      ]
    );

    const items = await menuItems('важное');
    expect(items).toContain('Открепить');
    expect(items).not.toContain('Закрепить');
  });

  it('фото с подписью: копировать текст и изображение, сохранить', async () => {
    vi.stubGlobal('ClipboardItem', class {});
    open([
      makeMessage({
        senderId: PEER,
        type: 'image',
        content: 'закат',
        mediaUrl: 'blob:photo',
        mediaEncryption: { mimeType: 'image/png' },
      } as never),
    ]);

    const items = await menuItems('закат');
    expect(items).toEqual(
      expect.arrayContaining(['Копировать текст', 'Копировать изображение', 'Сохранить как…'])
    );
  });

  it('«Копировать» кладёт текст в буфер и подтверждает уведомлением; меню закрывается', async () => {
    open([makeMessage({ senderId: ME, content: 'в буфер' })]);

    fireEvent.contextMenu(await screen.findByText('в буфер'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Копировать' }));

    expect(clipboard.writeText).toHaveBeenCalledWith('в буфер');
    await waitFor(() => expect(getToasts().map((toast) => toast.message)).toContain('Скопировано'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('отказ буфера — уведомление об ошибке', async () => {
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    open([makeMessage({ senderId: ME, content: 'не скопируется' })]);

    fireEvent.contextMenu(await screen.findByText('не скопируется'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Копировать' }));

    await waitFor(() =>
      expect(getToasts().map((toast) => toast.message)).toContain('Не удалось скопировать')
    );
  });

  it('«Сохранить как…» скачивает расшифрованный файл под исходным именем', async () => {
    const clicks: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicks.push({ href: this.href, download: this.download });
    });
    open([
      makeMessage({
        senderId: PEER,
        type: 'file',
        content: 'договор',
        mediaUrl: 'blob:file',
        mediaEncryption: { fileName: 'договор.pdf', mimeType: 'application/pdf' },
      } as never),
    ]);

    fireEvent.contextMenu(await screen.findByText('договор'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Сохранить как…' }));

    expect(clicks).toEqual([{ href: 'blob:file', download: 'договор.pdf' }]);
  });

  it('«Изменить» переводит поле ввода в режим правки', async () => {
    const message = makeMessage({ senderId: ME, content: 'поправлю' });
    open([message]);

    fireEvent.contextMenu(await screen.findByText('поправлю'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Изменить' }));

    expect(useChatUiStore.getState().editingMessage?.id).toBe(message.id);
  });
});
