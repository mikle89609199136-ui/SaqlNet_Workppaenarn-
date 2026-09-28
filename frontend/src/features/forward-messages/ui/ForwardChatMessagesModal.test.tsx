import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatKeys } from '@/entities/chat';
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
