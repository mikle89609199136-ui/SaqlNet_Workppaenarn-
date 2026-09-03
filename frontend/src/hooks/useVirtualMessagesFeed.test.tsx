import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { useVirtualMessagesFeed } from './useVirtualMessagesFeed';

describe('useVirtualMessagesFeed', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
  );

  it('creates date dividers and message feed items from message list', () => {
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

    const { result } = renderHook(
      () => useVirtualMessagesFeed({ messages: [m1, m2] }),
      { wrapper }
    );

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

    const { result } = renderHook(
      () => useVirtualMessagesFeed({ messages: [m1, m2] }),
      { wrapper }
    );

    expect(result.current.messagesById.get('msg-1')?.id).toBe('msg-1');
    expect(result.current.messagesById.get('msg-2')?.id).toBe('msg-2');
  });
});
