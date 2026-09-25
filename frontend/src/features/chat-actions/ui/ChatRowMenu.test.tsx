import { makeChat } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createRef } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { ChatRowMenu } from './ChatRowMenu';
import type { IChatDto } from '@/entities/chat';

function renderMenu(chat: IChatDto, onClose = () => {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ChatRowMenu
          chat={chat}
          onClose={onClose}
          pinnedCount={0}
          returnFocusRef={createRef<HTMLElement>()}
          x={0}
          y={0}
        />
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('меню строки чата', () => {
  it('не предлагает «Прочитано» там, где непрочитанных нет', () => {
    // Пункт, который нечего делать, — это предложение нажать в пустоту.
    renderMenu(makeChat({ unreadCount: 0 }));

    expect(screen.queryByRole('menuitem', { name: 'Прочитано' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Закрепить' })).toBeInTheDocument();
  });

  it('отмечает чат прочитанным и закрывает меню', async () => {
    const calls: string[] = [];
    server.use(
      http.post(api('/chats/:chatId/read'), () => {
        calls.push('POST');
        return HttpResponse.json({ chatId: 'chat-1' });
      })
    );

    const onClose = vi.fn();
    renderMenu(makeChat({ unreadCount: 3 }), onClose);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Прочитано' }));

    await waitFor(() => expect(calls).toContain('POST'));
    expect(onClose).toHaveBeenCalled();
  });

  it('для личного чата показывает пункт «Заблокировать» и открывает диалог подтверждения', async () => {
    let blockCalled = false;
    server.use(
      http.get(api('/users/blocked'), () => HttpResponse.json({ blocked: [] })),
      http.post(api('/users/blocked'), () => {
        blockCalled = true;
        return HttpResponse.json({ success: true });
      })
    );

    const onClose = vi.fn();
    renderMenu(
      makeChat({ id: 'chat-priv', type: 'private', peerId: 'user-peer', title: 'Собеседник' }),
      onClose
    );

    const blockItem = await screen.findByRole('menuitem', { name: 'Заблокировать' });
    expect(blockItem).toBeInTheDocument();
    await userEvent.click(blockItem);

    expect(
      await screen.findByRole('dialog', { name: 'Заблокировать пользователя?' })
    ).toBeInTheDocument();

    const confirmBtns = screen.getAllByRole('button', { name: 'Заблокировать' });
    const dialogConfirmBtn = confirmBtns[confirmBtns.length - 1];
    await userEvent.click(dialogConfirmBtn);

    await waitFor(() => expect(blockCalled).toBe(true));
    expect(onClose).toHaveBeenCalled();
  });

  it('для личного чата с заблокированным показывает «Разблокировать»', async () => {
    let unblockCalled = false;
    server.use(
      http.get(api('/users/blocked'), () =>
        HttpResponse.json({
          blocked: [
            {
              id: 'user-peer',
              username: 'peer',
              firstName: 'Иван',
              lastName: '',
              avatarUrl: '',
              blockedAt: '2026-01-01',
            },
          ],
        })
      ),
      http.delete(api('/users/blocked/:userId'), () => {
        unblockCalled = true;
        return HttpResponse.json({ success: true });
      })
    );

    const onClose = vi.fn();
    renderMenu(
      makeChat({ id: 'chat-priv', type: 'private', peerId: 'user-peer', title: 'Собеседник' }),
      onClose
    );

    const unblockItem = await screen.findByRole('menuitem', { name: 'Разблокировать' });
    expect(unblockItem).toBeInTheDocument();
    await userEvent.click(unblockItem);

    await waitFor(() => expect(unblockCalled).toBe(true));
    expect(onClose).toHaveBeenCalled();
  });

  it('для группового чата не показывает пунктов блокировки', () => {
    renderMenu(makeChat({ type: 'group', peerId: undefined }));

    expect(screen.queryByRole('menuitem', { name: 'Заблокировать' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Разблокировать' })).not.toBeInTheDocument();
  });
});
