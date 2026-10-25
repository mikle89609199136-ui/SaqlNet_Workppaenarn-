import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatKeys } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { clearToasts, getToasts } from '@/shared/ui';
import { services } from '@/services';
import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { useForwardStore } from '../model/forwardStore';
import { ForwardChatMessagesModal } from './ForwardChatMessagesModal';

describe('выбор чата для пересылки (#93)', () => {
  beforeEach(() => {
    useForwardStore.getState().cancel();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ничего не отправляет, а готовит пересылку и открывает целевой чат', async () => {
    const forward = vi.spyOn(services.messageService, 'forwardMessages');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.list(), [
      { id: 'chat-target', type: 'private', title: 'Борис', peerId: 'user-b' },
    ]);
    const messages = [makeMessage({ content: 'первое' })];
    const setSelectedMessages = vi.fn();
    const setSelectionMode = vi.fn();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={testI18n}>
          <MemoryRouter initialEntries={['/chats/chat-source']}>
            <Routes>
              <Route
                element={
                  <ForwardChatMessagesModal
                    messages={messages}
                    onClose={onClose}
                    setSelectedMessages={setSelectedMessages}
                    setSelectionMode={setSelectionMode}
                  />
                }
                path="/chats/chat-source"
              />
              <Route element={<p>целевой чат</p>} path="/chats/chat-target" />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>
    );

    await userEvent.click(await screen.findByText('Борис'));

    expect(forward).not.toHaveBeenCalled();
    expect(useForwardStore.getState().pending).toEqual({
      targetChatId: 'chat-target',
      messages,
    });
    expect(setSelectedMessages).toHaveBeenCalledWith([]);
    expect(setSelectionMode).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('целевой чат')).toBeInTheDocument();
  });
});

/* «Избранное» — первой строкой, даже если чата ещё нет: сервер заведёт
   его при выборе (#1075). */
describe('пересылка в «Избранное»', () => {
  const messages = [makeMessage({ content: 'сохранить' })];

  beforeEach(() => {
    useForwardStore.getState().cancel();
    useProfileStore.setState({ user: { id: 'user-me' } as never, isAuth: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearToasts();
  });

  function renderPicker(chats: unknown[]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(chatKeys.list(), chats);
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={testI18n}>
          <MemoryRouter initialEntries={['/chats/chat-source']}>
            <Routes>
              <Route
                element={
                  <ForwardChatMessagesModal
                    messages={messages}
                    onClose={onClose}
                    setSelectedMessages={vi.fn()}
                    setSelectionMode={vi.fn()}
                  />
                }
                path="/chats/chat-source"
              />
              <Route element={<p>избранное открыто</p>} path="/chats/:chatId" />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>
    );
    return { onClose };
  }

  const boris = { id: 'chat-b', type: 'private', title: 'Борис', peerId: 'user-b' };

  it('чата ещё нет — первая строка «Избранное», выбор заводит его и готовит пересылку', async () => {
    const open = vi
      .spyOn(services.chatService, 'openSavedMessages')
      .mockResolvedValue('chat-saved');
    renderPicker([boris]);

    const rows = screen.getAllByRole('button').filter((button) => button.closest('li'));
    expect(rows[0]).toHaveTextContent('Избранное');

    await userEvent.click(screen.getByRole('button', { name: 'Избранное' }));

    expect(open).toHaveBeenCalledWith('user-me');
    expect(await screen.findByText('избранное открыто')).toBeInTheDocument();
    expect(useForwardStore.getState().pending).toEqual({ targetChatId: 'chat-saved', messages });
  });

  it('чат уже есть — без запроса, и строка «Избранное» одна', async () => {
    const open = vi.spyOn(services.chatService, 'openSavedMessages');
    renderPicker([boris, { id: 'chat-self', type: 'self', title: 'Избранное' }]);

    expect(screen.getAllByText('Избранное')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Избранное' }));

    expect(open).not.toHaveBeenCalled();
    expect(useForwardStore.getState().pending?.targetChatId).toBe('chat-self');
  });

  it('поиск: «избр» оставляет «Избранное», «Борис» — скрывает', async () => {
    renderPicker([boris]);
    const field = screen.getByPlaceholderText('Поиск чата...');

    await userEvent.type(field, 'избр');
    expect(await screen.findByRole('button', { name: 'Избранное' })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByText('Борис')).toBeNull());

    await userEvent.clear(field);
    await userEvent.type(field, 'Борис');
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Избранное' })).toBeNull());
    expect(screen.getByText('Борис')).toBeInTheDocument();
  });

  it('не удалось завести — тост, окно открыто, пересылка не начата', async () => {
    vi.spyOn(services.chatService, 'openSavedMessages').mockRejectedValue(new Error('500'));
    const { onClose } = renderPicker([boris]);

    await userEvent.click(screen.getByRole('button', { name: 'Избранное' }));

    await vi.waitFor(() =>
      expect(getToasts()).toEqual([
        expect.objectContaining({ message: 'Не удалось открыть Избранное' }),
      ])
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(useForwardStore.getState().pending).toBeNull();
  });

  it('двойной щелчок — один запрос', async () => {
    let finish!: (chatId: string) => void;
    const open = vi.spyOn(services.chatService, 'openSavedMessages').mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );
    renderPicker([boris]);

    const saved = screen.getByRole('button', { name: 'Избранное' });
    await userEvent.dblClick(saved);
    finish('chat-saved');

    expect(open).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('избранное открыто')).toBeInTheDocument();
  });
});
