import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { chatKeys } from '@/entities/chat';
import { queryClient } from '@/shared/api';
import { makeMessage } from '@/test/fixtures';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { useServerEvents } from './useServerEvents';

const CHAT = 'chat-delete-events';

function mount() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useServerEvents(true), { wrapper });
}

const ids = () =>
  (queryClient.getQueryData<{ pages: { id: string }[][] }>(chatKeys.messages(CHAT))?.pages ?? [])
    .flat()
    .map((message) => message.id);

/* Удаление пачкой по событиям сокета (#840): сообщения убираются из ленты
   на месте, без перезапроса истории. */
describe('удалённые и скрытые сообщения — события сокета', () => {
  afterEach(() => queryClient.clear());

  const seed = () =>
    queryClient.setQueryData(chatKeys.messages(CHAT), {
      pages: [
        [
          makeMessage({ id: 'm-1', chatId: CHAT }),
          makeMessage({ id: 'm-2', chatId: CHAT }),
          makeMessage({ id: 'm-3', chatId: CHAT }),
        ],
      ],
      pageParams: [0],
    });

  it('messages_hidden — скрытое на другом своём устройстве пропадает и здесь', async () => {
    seed();
    mount();

    fakeSocket.emit('messages_hidden', { chatId: CHAT, messageIds: ['m-1', 'm-3'] });

    await waitFor(() => expect(ids()).toEqual(['m-2']));
  });

  it('messages_deleted — удалённое у всех пропадает', async () => {
    seed();
    mount();

    fakeSocket.emit('messages_deleted', { chatId: CHAT, messageIds: ['m-2'] });

    await waitFor(() => expect(ids()).toEqual(['m-1', 'm-3']));
  });
});
