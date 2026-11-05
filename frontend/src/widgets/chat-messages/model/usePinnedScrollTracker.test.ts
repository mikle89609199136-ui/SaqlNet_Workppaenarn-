import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { makeMessage, makePin } from '@/test/fixtures';
import type { TFeedItem } from './useVirtualMessagesFeed';
import { findActivePinnedMessageId, usePinnedScrollTracker } from './usePinnedScrollTracker';

describe('findActivePinnedMessageId (#1057)', () => {
  const pin1 = makePin({
    messageId: 'msg-1',
    message: makeMessage({ id: 'msg-1', createdAt: new Date('2026-01-01T10:00:00Z') }),
  });
  const pin2 = makePin({
    messageId: 'msg-2',
    message: makeMessage({ id: 'msg-2', createdAt: new Date('2026-01-02T10:00:00Z') }),
  });
  const pin3 = makePin({
    messageId: 'msg-3',
    message: makeMessage({ id: 'msg-3', createdAt: new Date('2026-01-03T10:00:00Z') }),
  });

  const feedItems: TFeedItem[] = [
    { id: 'date-1', type: 'date', label: '1 января' },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `m-pre-${i}`,
      type: 'message' as const,
      message: makeMessage({ id: `m-pre-${i}`, createdAt: new Date('2026-01-01T09:00:00Z') }),
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    })),
    // Index 10: msg-1 (Pin 1)
    {
      id: 'msg-1',
      type: 'message' as const,
      message: pin1.message,
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    },
    ...Array.from({ length: 39 }, (_, i) => ({
      id: `m-mid-${i}`,
      type: 'message' as const,
      message: makeMessage({ id: `m-mid-${i}`, createdAt: new Date('2026-01-01T15:00:00Z') }),
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    })),
    // Index 50: msg-2 (Pin 2)
    {
      id: 'msg-2',
      type: 'message' as const,
      message: pin2.message,
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    },
    ...Array.from({ length: 39 }, (_, i) => ({
      id: `m-post-${i}`,
      type: 'message' as const,
      message: makeMessage({ id: `m-post-${i}`, createdAt: new Date('2026-01-02T15:00:00Z') }),
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    })),
    // Index 90: msg-3 (Pin 3)
    {
      id: 'msg-3',
      type: 'message' as const,
      message: pin3.message,
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    },
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `m-end-${i}`,
      type: 'message' as const,
      message: makeMessage({ id: `m-end-${i}`, createdAt: new Date('2026-01-03T15:00:00Z') }),
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    })),
  ];

  it('возвращает null, если закрепления отсутствуют или лента пуста', () => {
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [],
        feedItems,
        virtualItems: [{ index: 0 }],
      })
    ).toBeNull();

    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1],
        feedItems: [],
        virtualItems: [],
      })
    ).toBe('msg-1');
  });

  it('возвращает видимый пин, если он находится в пределах virtualItems', () => {
    // Видна область 8..15 (содержит msg-1 на индексе 10)
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        virtualItems: [{ index: 8 }, { index: 10 }, { index: 15 }],
      })
    ).toBe('msg-1');

    // Видна область 48..55 (содержит msg-2 на индексе 50)
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        virtualItems: [{ index: 48 }, { index: 50 }, { index: 55 }],
      })
    ).toBe('msg-2');
  });

  it('выбирает верхний видимый пин, если на экране видно несколько пинов', () => {
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        virtualItems: [{ index: 10 }, { index: 50 }],
      })
    ).toBe('msg-1');
  });

  it('выбирает ближайший пройденный пин выше экрана, если на экране нет закреплений', () => {
    // Скролл между Pin 1 (10) и Pin 2 (50): видимы строки 25..35
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        virtualItems: [{ index: 25 }, { index: 30 }, { index: 35 }],
      })
    ).toBe('msg-1');

    // Скролл между Pin 2 (50) и Pin 3 (90): видимы строки 65..75
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        virtualItems: [{ index: 65 }, { index: 70 }, { index: 75 }],
      })
    ).toBe('msg-2');

    // Скролл в самом низу ленты после Pin 3 (90): видимы строки 100..110
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        virtualItems: [{ index: 100 }, { index: 105 }, { index: 110 }],
      })
    ).toBe('msg-3');
  });

  it('удерживает первый пин при скролле выше всех закреплений', () => {
    // Видимы строки 0..5 (выше Pin 1 на индексе 10)
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        virtualItems: [{ index: 0 }, { index: 2 }, { index: 5 }],
      })
    ).toBe('msg-1');
  });

  it('учитывает закрепления, ещё не догруженные в ленту (hasOlder)', () => {
    const olderPin = makePin({
      messageId: 'msg-older',
      message: makeMessage({ id: 'msg-older', createdAt: new Date('2025-12-01T10:00:00Z') }),
    });

    // olderPin отсутствует в feedItems, но старше всех загруженных сообщений
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [olderPin, pin2],
        feedItems,
        virtualItems: [{ index: 20 }], // до pin2 (50)
      })
    ).toBe('msg-older');
  });
});

describe('usePinnedScrollTracker (#1057)', () => {
  beforeEach(() => {
    useChatUiStore.getState().resetChatState();
    vi.restoreAllMocks();
  });

  const pin1 = makePin({ messageId: 'm-1', message: makeMessage({ id: 'm-1' }) });
  const pin2 = makePin({ messageId: 'm-2', message: makeMessage({ id: 'm-2' }) });

  const feedItems: TFeedItem[] = [
    {
      id: 'm-1',
      type: 'message',
      message: pin1.message,
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    },
    {
      id: 'm-2',
      type: 'message',
      message: pin2.message,
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    },
  ];

  it('устанавливает activePinnedId при скролле', () => {
    const { rerender } = renderHook(
      ({ virtualItems }) =>
        usePinnedScrollTracker({
          pinnedMessages: [pin1, pin2],
          feedItems,
          virtualItems,
        }),
      { initialProps: { virtualItems: [{ index: 0 }] } }
    );

    expect(useChatUiStore.getState().activePinnedId).toBe('m-1');

    rerender({ virtualItems: [{ index: 1 }] });
    expect(useChatUiStore.getState().activePinnedId).toBe('m-2');
  });

  it('игнорирует обновления от скролла при активном pinnedNavLockUntil', () => {
    useChatUiStore.getState().setActivePinnedId('m-1');
    useChatUiStore.getState().setPinnedNavLockUntil(Date.now() + 5000);

    renderHook(() =>
      usePinnedScrollTracker({
        pinnedMessages: [pin1, pin2],
        feedItems,
        virtualItems: [{ index: 1 }],
      })
    );

    // activePinnedId остался 'm-1', так как лок заблокировал изменение
    expect(useChatUiStore.getState().activePinnedId).toBe('m-1');
  });

  it('сбрасывает activePinnedId в null при пустом списке пинов', () => {
    useChatUiStore.getState().setActivePinnedId('m-1');

    renderHook(() =>
      usePinnedScrollTracker({
        pinnedMessages: [],
        feedItems,
        virtualItems: [{ index: 0 }],
      })
    );

    expect(useChatUiStore.getState().activePinnedId).toBeNull();
  });
});
