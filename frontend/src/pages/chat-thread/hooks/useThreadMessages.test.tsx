import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { chatKeys } from '@/entities/chat';
import { makeMessage } from '@/test/fixtures';
import { createTestQueryClient } from '@/test/harness/renderChatThread';
import { useThreadMessages } from './useThreadMessages';

const CHAT_ID = 'chat-1';

function setup() {
  const queryClient = createTestQueryClient();

  queryClient.setQueryData(chatKeys.messages(CHAT_ID), {
    pages: [[makeMessage({ id: 'm-1' }), makeMessage({ id: 'm-2' })]],
    pageParams: [0],
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return renderHook(
    () => useThreadMessages({ chatId: CHAT_ID, containerRef: createRef<HTMLElement>() }),
    { wrapper }
  );
}

describe('useThreadMessages', () => {
  it('should return the same messages reference when nothing changed', () => {
    // Лента — зависимость эффектов на странице чата. Если ссылка меняется
    // на каждом рендере, эффект синхронизации профиля пишет в состояние
    // родителя, тот перерисовывает тред — и цикл не заканчивается.
    const { result, rerender } = setup();

    const first = result.current.messages;
    rerender();

    expect(result.current.messages).toBe(first);
  });

  it('should return the messages in chronological order', () => {
    const { result } = setup();

    expect(result.current.messages.map((message) => message.id)).toEqual(['m-1', 'm-2']);
  });

  it('automatically preloads older history when an unresolved reply exists', async () => {
    const queryClient = createTestQueryClient();
    const chatKey = chatKeys.messages('chat-replies');
    // 50 сообщений, одно из которых содержит ответ на msg-older
    const initialPage = Array.from({ length: 50 }, (_, i) =>
      makeMessage({
        id: `m-${i}`,
        replyTo: i === 49 ? 'msg-older-999' : null,
      })
    );

    queryClient.setQueryData(chatKey, {
      pages: [initialPage],
      pageParams: [0],
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useThreadMessages({ chatId: 'chat-replies', containerRef: createRef<HTMLElement>() }),
      { wrapper }
    );

    expect(result.current.hasOlder).toBe(true);
  });
});
