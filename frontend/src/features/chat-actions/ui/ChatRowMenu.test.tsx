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
import { ChatRowMenu, type IChatRowMenuProps } from './ChatRowMenu';
import { DeleteChatDialog } from './DeleteChatDialog';
import type { IChatDto } from '@/types';

function renderMenu(chat: IChatDto, onClose = () => {}, extra: Partial<IChatRowMenuProps> = {}) {
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
          {...extra}
        />
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe('меню строки чата', () => {
  const items = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

  it.each([false, true])('сохраняет переключение на сервере (скрыто: %s)', async (hidden) => {
    const chat = makeChat({ hideNotificationPreview: hidden });
    const save = vi.fn();
    server.use(
      http.put(api('/chats/:chatId/notification-settings'), async ({ request, params }) => {
        save(params.chatId, await request.json());
        return HttpResponse.json({ success: true });
      })
    );
    const onClose = vi.fn();
    renderMenu(chat, onClose);
    await userEvent.click(
      screen.getByRole('menuitem', {
        name: hidden ? 'Показывать текст в уведомлениях' : 'Скрывать текст в уведомлениях',
      })
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(chat.id, { hideNotificationPreview: !hidden })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('по макету: состояние строки сверху, уводящее из чата — после разделителя (#825)', () => {
    renderMenu(makeChat({ type: 'group', unreadCount: 3 }), () => {}, { onLeave: vi.fn() });

    expect(screen.getByRole('menu', { name: /^Действия: / })).toBeInTheDocument();
    expect(items()).toEqual([
      'Закрепить',
      'Отметить как прочитанное',
      'Скрывать текст в уведомлениях',
      'Отключить уведомления',
      'Архивировать',
      'Покинуть группу',
    ]);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('скрытые пункты без функции не показываются', () => {
    renderMenu(makeChat({ type: 'private', unreadCount: 0 }));

    expect(items()).toEqual([
      'Закрепить',
      'Скрывать текст в уведомлениях',
      'Отключить уведомления',
      'Архивировать',
    ]);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('скрытые пункты появляются, когда передана функция', async () => {
    const onMarkUnread = vi.fn();
    const onToggle = vi.fn();
    const onDelete = vi.fn();
    const onClose = vi.fn();
    renderMenu(makeChat({ type: 'private', unreadCount: 0 }), onClose, {
      onMarkUnread,
      mute: { muted: false, onToggle },
      onDelete,
    });

    expect(items()).toEqual([
      'Закрепить',
      'Отметить как непрочитанное',
      'Скрывать текст в уведомлениях',
      'Отключить уведомления',
      'Архивировать',
      'Удалить чат',
    ]);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Отключить уведомления' }));
    expect(onToggle).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('в архиве не закрепляют, а возвращают', () => {
    renderMenu(makeChat({ type: 'private', isArchived: true, unreadCount: 0 }));
    expect(items()).toEqual([
      'Скрывать текст в уведомлениях',
      'Отключить уведомления',
      'Вернуть из архива',
    ]);
  });

  it('не предлагает «Прочитано» там, где непрочитанных нет', () => {
    // Пункт, который нечего делать, — это предложение нажать в пустоту.
    renderMenu(makeChat({ unreadCount: 0 }));

    expect(
      screen.queryByRole('menuitem', { name: 'Отметить как прочитанное' })
    ).not.toBeInTheDocument();
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

    await userEvent.click(screen.getByRole('menuitem', { name: 'Отметить как прочитанное' }));

    await waitFor(() => expect(calls).toContain('POST'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('подтверждение «Удалить чат» (#825, вход скрыт до #838)', () => {
  function renderDialog(onConfirm = vi.fn()) {
    render(
      <I18nextProvider i18n={testI18n}>
        <DeleteChatDialog onCancel={vi.fn()} onConfirm={onConfirm} open title="Вася" />
      </I18nextProvider>
    );
    return onConfirm;
  }

  it('по умолчанию удаляет только у себя', async () => {
    const onConfirm = renderDialog();

    expect(screen.getByText(/Чат «Вася» исчезнет/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('галочкой — и у собеседника', async () => {
    const onConfirm = renderDialog();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Удалить и у собеседника' }));
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(onConfirm).toHaveBeenCalledWith(true);
  });
});

/* У «Избранного» уведомлений нет — и прятать в них нечего (#1075). */
describe('меню строки «Избранного»', () => {
  it('без пункта про текст в уведомлениях, закрепление на месте', () => {
    renderMenu(makeChat({ type: 'self', title: 'Избранное' }));

    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items.some((item) => /уведомлениях/.test(item ?? ''))).toBe(false);
    expect(screen.getByRole('menuitem', { name: /Закрепить/ })).toBeInTheDocument();
  });
});
