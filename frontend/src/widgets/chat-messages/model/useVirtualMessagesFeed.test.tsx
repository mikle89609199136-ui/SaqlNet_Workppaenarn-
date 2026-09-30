import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { useVirtualMessagesFeed } from './useVirtualMessagesFeed';

describe('useVirtualMessagesFeed', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
  );

  it('creates in-stream date dividers and message feed items from message list', () => {
    const m1 = makeMessage({
      id: 'msg-1',
      content: 'День 1',
      createdAt: '2026-05-10T10:00:00Z',
    });
    const m2 = makeMessage({
      id: 'msg-2',
      content: 'День 2',
      createdAt: '2026-05-11T12:00:00Z',
    });

    const { result } = renderHook(() => useVirtualMessagesFeed({ messages: [m1, m2] }), {
      wrapper,
    });

    // 2 даты + 2 сообщения = 4 элемента
    expect(result.current.feedItems).toHaveLength(4);
    expect(result.current.feedItems[0].type).toBe('date');
    expect(result.current.feedItems[1].type).toBe('message');
    expect(result.current.feedItems[2].type).toBe('date');
    expect(result.current.feedItems[3].type).toBe('message');
  });

  it('builds O(1) messagesById lookup map for reply previews', () => {
    const m1 = makeMessage({ id: 'msg-1', content: 'Привет' });
    const m2 = makeMessage({ id: 'msg-2', replyTo: 'msg-1', content: 'Ответ' });

    const { result } = renderHook(() => useVirtualMessagesFeed({ messages: [m1, m2] }), {
      wrapper,
    });

    expect(result.current.messagesById.get('msg-1')?.id).toBe('msg-1');
    expect(result.current.messagesById.get('msg-2')?.id).toBe('msg-2');
  });

  /* «Новые сообщения» (#820): по отметке прочтения чата (#839). */
  describe('разделитель новых сообщений', () => {
    const ME = 'user-me';
    /** Минута — время сообщения; отметка прочтения — тоже минутой. */
    const at = (minute: number) => `2026-05-10T10:${String(minute).padStart(2, '0')}:00Z`;
    const incoming = (id: string, minute: number) =>
      makeMessage({ id, chatId: 'chat-1', senderId: 'user-2', createdAt: at(minute) });
    const own = (id: string, minute: number) =>
      makeMessage({ id, chatId: 'chat-1', senderId: ME, createdAt: at(minute) });
    const readMark = (minute: number, unreadCount: number) => ({
      chatId: 'chat-1',
      lastReadAt: at(minute),
      unreadCount,
    });

    const types = (items: { type: string; id: string }[]) =>
      items.map((item) => (item.type === 'message' ? item.id : item.type));

    it('стоит перед первым чужим новее отметки прочтения', () => {
      const messages = [incoming('m1', 1), own('m2', 2), incoming('m3', 3), incoming('m4', 4)];

      const { result } = renderHook(
        () => useVirtualMessagesFeed({ messages, currentUserId: ME, readMark: readMark(2, 2) }),
        { wrapper }
      );

      expect(types(result.current.feedItems)).toEqual(['date', 'm1', 'm2', 'unread', 'm3', 'm4']);
    });

    it('остаётся на месте, когда чат отметился прочитанным', () => {
      /* Лента отмечает прочитанным сразу после загрузки, и отметка чата
         уходит вперёд — без снимка разделитель пропал бы в ту же секунду. */
      const messages = [incoming('m1', 1), incoming('m2', 2)];
      let mark = readMark(1, 1);

      const { result, rerender } = renderHook(
        () => useVirtualMessagesFeed({ messages, currentUserId: ME, readMark: mark }),
        { wrapper }
      );

      mark = readMark(2, 0);
      rerender();

      expect(types(result.current.feedItems)).toEqual(['date', 'm1', 'unread', 'm2']);
    });

    it('своё непрочитанным не считается, и без чужих новых разделителя нет', () => {
      const messages = [incoming('m1', 1), own('m2', 2)];

      const { result } = renderHook(
        () => useVirtualMessagesFeed({ messages, currentUserId: ME, readMark: readMark(1, 0) }),
        { wrapper }
      );

      expect(types(result.current.feedItems)).not.toContain('unread');
    });

    it('в подборке закреплённых разделителя нет', () => {
      const messages = [incoming('m1', 1)];

      const { result } = renderHook(
        () =>
          useVirtualMessagesFeed({
            messages,
            currentUserId: ME,
            trackUnread: false,
            readMark: readMark(0, 1),
          }),
        { wrapper }
      );

      expect(types(result.current.feedItems)).not.toContain('unread');
    });

    it('первое непрочитанное выше загруженного — догружает до него', async () => {
      let messages = [incoming('m3', 3), incoming('m4', 4)];
      let hasOlder = true;
      const loadOlder = vi.fn(async () => {
        messages = [incoming('m1', 1), incoming('m2', 2), ...messages];
        hasOlder = false;
      });

      const { result, rerender } = renderHook(
        () =>
          useVirtualMessagesFeed({
            messages,
            currentUserId: ME,
            readMark: readMark(1, 3),
            loadOlder,
            hasOlder,
          }),
        { wrapper }
      );

      await waitFor(() => expect(loadOlder).toHaveBeenCalledWith({ isJump: true }));
      rerender();

      expect(loadOlder).toHaveBeenCalledTimes(1);
      expect(types(result.current.feedItems)).toEqual(['date', 'm1', 'unread', 'm2', 'm3', 'm4']);
    });
  });
});
