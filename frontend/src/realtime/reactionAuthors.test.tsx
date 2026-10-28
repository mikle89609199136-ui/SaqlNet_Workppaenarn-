import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { messageKeys, beginReactionChange, endReactionChange } from '@/entities/message';
import { useChatUiStore } from '@/entities/chat';
import { fakeSocket } from '@/test/harness/fakeSocket';
import { useServerEvents } from './useServerEvents';

it('WS reaction_updated инвалидирует авторов даже во время локальной операции', async () => {
  const client = new QueryClient();
  const key = [...messageKeys.reactionAuthorsPrefix('message-998'), '👍'];
  client.setQueryData(key, { pages: [] });
  const unrelated = [...messageKeys.reactionAuthorsPrefix('another'), '👍'];
  client.setQueryData(unrelated, { pages: [] });
  const { unmount } = renderHook(() => useServerEvents(true), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  useChatUiStore
    .getState()
    .setReactionAuthorsModal({ messageId: 'message-998', chatId: 'chat-998', reactions: [] });
  beginReactionChange('message-998');
  fakeSocket.emit('reaction_updated', {
    chatId: 'chat-998',
    messageId: 'message-998',
    actorId: 'author',
    change: { action: 'added', emoji: '👍' },
    reactions: [{ emoji: '👍', count: 1 }],
  });
  await waitFor(() => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
  expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  expect(useChatUiStore.getState().reactionAuthorsModal?.reactions).toEqual([
    { emoji: '👍', count: 1, myReaction: false },
  ]);
  useChatUiStore.getState().setReactionAuthorsModal(null);
  endReactionChange('message-998');
  unmount();
  client.clear();
});
