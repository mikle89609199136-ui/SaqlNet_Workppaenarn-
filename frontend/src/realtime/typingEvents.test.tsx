import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { useTypingStore } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import { queryClient } from '@/shared/api';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { useServerEvents } from './useServerEvents';

const GROUP = 'group-typing';

function mount() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useServerEvents(true), { wrapper });
}

const typers = () => useTypingStore.getState().typingByChat[GROUP];

/* «Печатает» по событиям сокета (#837). */
describe('кто печатает — события сокета', () => {
  let process: MockInstance;

  beforeEach(() => {
    // Расшифровка здесь не проверяется: входящее кладётся в ленту как есть.
    process = vi
      .spyOn(services.messageService, 'processMessageForDisplay')
      .mockImplementation(async (_chatId, message) => message as never);
  });

  afterEach(() => {
    // Восстанавливаем только свою подмену: при isolate: false общий
    // restoreAllMocks сбросил бы чужие глобальные моки.
    process.mockRestore();
    useTypingStore.getState().clearTyping(GROUP);
    queryClient.clear();
  });

  it('имя из события попадает в стор', async () => {
    mount();

    fakeSocket.emit('typing', { chatId: GROUP, userId: 'igor', firstName: 'Игорь' });

    await waitFor(() => expect(typers()).toEqual([{ userId: 'igor', firstName: 'Игорь' }]));
  });

  it('сообщение от печатающего снимает его сразу, не дожидаясь таймера', async () => {
    mount();
    fakeSocket.emit('typing', { chatId: GROUP, userId: 'igor' });
    fakeSocket.emit('typing', { chatId: GROUP, userId: 'masha' });
    await waitFor(() => expect(typers()).toHaveLength(2));

    fakeSocket.emit('new_message', {
      chatId: GROUP,
      message: { id: 'm-1', chatId: GROUP, senderId: 'igor', content: 'готово', type: 'text' },
    });

    await waitFor(() => expect(typers()).toEqual([{ userId: 'masha', firstName: undefined }]));
  });
});
