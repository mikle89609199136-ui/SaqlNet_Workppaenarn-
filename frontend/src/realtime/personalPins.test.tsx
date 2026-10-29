import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { chatKeys } from '@/entities/chat';
import { makeMessage, makePin } from '@/test/fixtures';
import { fakeSocket } from '@/test/harness/fakeSocket';
import type { IThreadPages } from '@/entities/message/model/threadCache';
import { useServerEvents } from './useServerEvents';

it('личные события обновляют только личный флаг и кеш своих закреплений', async () => {
  const client = new QueryClient();
  const message = makeMessage({
    id: 'm-999',
    chatId: 'c-999',
    isPinned: true,
    isChatPinned: true,
    isPersonalPinned: false,
  });
  client.setQueryData(chatKeys.messages('c-999'), { pages: [[message]], pageParams: [0] });
  client.setQueryData(chatKeys.pins('c-999'), [makePin({ message })]);
  client.setQueryData(chatKeys.personalPins('c-999'), []);
  const { unmount } = renderHook(() => useServerEvents(true), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  const current = () => client.getQueryData<IThreadPages>(chatKeys.messages('c-999'))!.pages[0][0];
  act(() =>
    fakeSocket.emit('message_personal_pinned', {
      type: 'message_personal_pinned',
      chatId: 'c-999',
      messageId: 'm-999',
      scope: 'personal',
      isPersonalPinned: true,
    })
  );
  await waitFor(() => expect(current().isPersonalPinned).toBe(true));
  expect(current().isChatPinned).toBe(true);
  expect(current().isPinned).toBe(true);
  expect(client.getQueryState(chatKeys.personalPins('c-999'))?.isInvalidated).toBe(true);
  expect(client.getQueryState(chatKeys.pins('c-999'))?.isInvalidated).toBe(false);
  act(() => fakeSocket.emit('message_unpinned', { chatId: 'c-999', messageId: 'm-999' }));
  await waitFor(() => expect(current().isChatPinned).toBe(false));
  expect(current().isPersonalPinned).toBe(true);
  act(() =>
    fakeSocket.emit('message_personal_unpinned', {
      type: 'message_personal_unpinned',
      chatId: 'c-999',
      messageId: 'm-999',
      scope: 'personal',
      isPersonalPinned: false,
    })
  );
  await waitFor(() => expect(current().isPersonalPinned).toBe(false));
  unmount();
  client.clear();
});
