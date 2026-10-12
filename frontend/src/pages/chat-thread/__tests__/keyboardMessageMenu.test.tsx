import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllDrafts, useChatUiStore } from '@/entities/chat';
import { makeChat, makeMessage, makeUser, resetFixtures } from '@/test/fixtures';
import { renderChatThread } from '@/test/harness/renderChatThread';
import { mockThreadLayout } from '@/test/harness/threadLayout';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import type { IMessageDto } from '@/types';

const ME = 'user-1';
const PEER = 'user-2';

function open({ lastIsMine = false } = {}) {
  const chat = makeChat({ id: 'chat-keys', type: 'private', peerId: PEER });
  const messages: IMessageDto[] = ['первое', 'второе', 'третье'].map((content, index) =>
    makeMessage({
      id: `msg-${index + 1}`,
      chatId: chat.id,
      senderId: lastIsMine && index === 2 ? ME : PEER,
      content,
      createdAt: `2026-10-01T12:0${index}:00Z`,
    })
  );
  server.use(
    http.get(api(`/chats/${chat.id}`), () => HttpResponse.json({ chat })),
    http.get(api(`/messages/${chat.id}`), () => HttpResponse.json({ messages })),
    http.get(api(`/chats/${chat.id}/pins`), () => HttpResponse.json({ pins: [] }))
  );
  renderChatThread({ chat, messages, currentUser: makeUser({ id: ME }) });
}

const article = (id: string) => document.getElementById(id)!;

function focusEditableOnSelection() {
  const setBaseAndExtent = Selection.prototype.setBaseAndExtent;
  vi.spyOn(Selection.prototype, 'setBaseAndExtent').mockImplementation(function (
    this: Selection,
    ...args: Parameters<Selection['setBaseAndExtent']>
  ) {
    setBaseAndExtent.apply(this, args);
    const [anchor] = args;
    const element = anchor instanceof Element ? anchor : anchor.parentElement;
    element?.closest<HTMLElement>('[contenteditable="true"]')?.focus();
  });
}

async function tabIntoFeed(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('третье');
  for (let step = 0; step < 40; step++) {
    await user.tab();
    if (document.activeElement?.matches('article[id]')) return document.activeElement;
  }
  throw new Error('Tab не дошёл до ленты');
}

async function focusMenuItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  await waitFor(() => expect(screen.getByRole('menu')).toContainElement(document.activeElement));
  for (let step = 0; step < 20; step++) {
    if (document.activeElement?.textContent?.trim() === name) return;
    await user.keyboard('{ArrowDown}');
  }
  throw new Error(`Пункт «${name}» не найден`);
}

beforeEach(() => {
  resetFixtures();
  clearAllDrafts();
  useChatUiStore.setState({ actionMenu: null, selectionMode: false, replyToMessage: null });
  mockThreadLayout({ viewport: 20_000 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('меню сообщения с клавиатуры (#910)', () => {
  it('без мыши: Tab в ленту, стрелкой к сообщению, Enter — меню, «Ответить» — ответ начат, фокус в поле', async () => {
    const user = userEvent.setup();
    focusEditableOnSelection();
    open();

    expect(await tabIntoFeed(user)).toBe(article('msg-3'));
    await user.keyboard('{ArrowUp}');
    expect(article('msg-2')).toHaveFocus();

    await user.keyboard('{Enter}');
    await focusMenuItem(user, 'Ответить');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(useChatUiStore.getState().replyToMessage?.id).toBe('msg-2');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Сообщение' })).toHaveFocus());
  });

  it('Escape в меню возвращает фокус на то же сообщение', async () => {
    const user = userEvent.setup();
    open();
    await tabIntoFeed(user);
    await user.keyboard('{ArrowUp}{ArrowUp}');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menu')).toContainElement(document.activeElement));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(article('msg-1')).toHaveFocus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Shift+F10 открывает меню, выбор пункта возвращает фокус на сообщение', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open();
    await tabIntoFeed(user);

    await user.keyboard('{Shift>}{F10}{/Shift}');
    await focusMenuItem(user, 'Копировать');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(article('msg-3')).toHaveFocus());
    expect(writeText).toHaveBeenCalledWith('третье');
  });

  it('кнопка «⋯» открывает меню сообщения', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('второе');

    const buttons = screen.getAllByRole('button', { name: 'Действия с сообщением' });
    await user.click(buttons[1]);

    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(useChatUiStore.getState().actionMenu?.messageId).toBe('msg-2');
  });

  it('своё последнее сообщение и пустое поле: ↑ в ленте ведёт к предыдущему, а не в правку', async () => {
    const user = userEvent.setup();
    open({ lastIsMine: true });

    expect(await tabIntoFeed(user)).toBe(article('msg-3'));
    await user.keyboard('{ArrowUp}');

    expect(article('msg-2')).toHaveFocus();
    expect(useChatUiStore.getState().editingMessage).toBeNull();
  });

  it('↑ в пустом поле ввода по-прежнему начинает правку своего последнего сообщения', async () => {
    const user = userEvent.setup();
    open({ lastIsMine: true });
    await screen.findByText('третье');

    await user.click(screen.getByRole('textbox', { name: 'Сообщение' }));
    await user.keyboard('{ArrowUp}');

    expect(useChatUiStore.getState().editingMessage?.id).toBe('msg-3');
  });
});
