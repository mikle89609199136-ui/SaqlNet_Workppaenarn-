import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatKeys, useChatUiStore } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { makeChat, makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import type { IThreadPages } from '@/entities/message/model/threadCache';
import { PinMessageDialog } from './PinMessageDialog';

afterEach(() => vi.restoreAllMocks());
function setup(
  type: 'private' | 'group' = 'private',
  role: 'owner' | 'member' = 'owner',
  unpin = false
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const chat = makeChat({ id: 'chat-999', title: 'Мария', type, role });
  const message = makeMessage({
    id: 'msg-999',
    chatId: chat.id,
    isPinned: true,
    isChatPinned: true,
    isPersonalPinned: true,
  });
  client.setQueryData(chatKeys.detail(chat.id), chat);
  client.setQueryData(chatKeys.messages(chat.id), { pages: [[message]], pageParams: [0] });
  useChatUiStore.getState().resetChatState();
  useChatUiStore.getState().setPinRequest({ targets: [message], unpin });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={testI18n}>
        <MemoryRouter initialEntries={['/chat/chat-999']}>
          <Routes>
            <Route path="/chat/:chatId" element={<PinMessageDialog />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return { client, message, chat };
}

describe('диалог области закрепления', () => {
  it.each(['personal', 'chat'] as const)(
    'отправляет scope %s и сохраняет независимое состояние',
    async (scope) => {
      const request = vi
        .spyOn(services.messageService, 'pinMessage')
        .mockResolvedValue({ success: true });
      const { client, message, chat } = setup();
      expect(screen.getByRole('dialog', { name: 'Закрепить сообщение?' })).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('radio', {
          name: scope === 'personal' ? 'Только для себя' : 'Для меня и Мария',
        })
      );
      await userEvent.click(screen.getByRole('button', { name: 'Закрепить' }));
      await waitFor(() => expect(useChatUiStore.getState().pinRequest).toBeNull());
      expect(request).toHaveBeenCalledExactlyOnceWith(chat.id, message.id, scope);
      const updated = client.getQueryData<IThreadPages>(chatKeys.messages(chat.id))!.pages[0][0];
      expect(updated.isChatPinned).toBe(true);
      expect(updated.isPersonalPinned).toBe(true);
    }
  );
  it('отмена не выполняет API-запрос', async () => {
    const request = vi.spyOn(services.messageService, 'pinMessage');
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(request).not.toHaveBeenCalled();
    expect(useChatUiStore.getState().pinRequest).toBeNull();
  });
  it('в группе участник может закрепить только для себя', async () => {
    const request = vi
      .spyOn(services.messageService, 'pinMessage')
      .mockResolvedValue({ success: true });
    setup('group', 'member');
    expect(screen.queryByRole('radio', { name: 'Для всех участников' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Закрепить' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('chat-999', 'msg-999', 'personal'));
  });
  it('для владельца группы доступен общий pin', () => {
    setup('group', 'owner');
    expect(screen.getByRole('radio', { name: 'Для всех участников' })).toBeInTheDocument();
  });
  it('снятие личного pin сохраняет общий', async () => {
    const request = vi.spyOn(services.messageService, 'unpinMessage').mockResolvedValue({});
    const { client } = setup('private', 'owner', true);
    await userEvent.click(screen.getByRole('button', { name: 'Открепить' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('chat-999', 'msg-999', 'personal'));
    const message = client.getQueryData<IThreadPages>(chatKeys.messages('chat-999'))!.pages[0][0];
    expect(message.isPersonalPinned).toBe(false);
    expect(message.isChatPinned).toBe(true);
    expect(message.isPinned).toBe(true);
  });
  it('ошибка оставляет диалог и прежние флаги', async () => {
    vi.spyOn(services.messageService, 'unpinMessage').mockRejectedValue(new Error('offline'));
    const { client } = setup('private', 'owner', true);
    await userEvent.click(screen.getByRole('button', { name: 'Открепить' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      client.getQueryData<IThreadPages>(chatKeys.messages('chat-999'))!.pages[0][0].isPersonalPinned
    ).toBe(true);
  });
});
