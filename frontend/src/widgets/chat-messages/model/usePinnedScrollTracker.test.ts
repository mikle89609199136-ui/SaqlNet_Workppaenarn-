import { renderHook } from '@testing-library/react';
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
        visibleRange: { startIndex: 0, endIndex: 0 },
      })
    ).toBeNull();

    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1],
        feedItems: [],
        visibleRange: null,
      })
    ).toBe('msg-1');
  });

  it('возвращает видимый пин, если он находится в видимой области', () => {
    // Видна область 8..15 (содержит msg-1 на индексе 10)
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 8, endIndex: 15 },
      })
    ).toBe('msg-1');

    // Видна область 48..55 (содержит msg-2 на индексе 50)
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 48, endIndex: 55 },
      })
    ).toBe('msg-2');
  });

  it('выбирает нижний видимый пин, если на экране видно несколько пинов', () => {
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 10, endIndex: 50 },
      })
    ).toBe('msg-2');

    // Низ чата: видны pin2 и pin3 — показывается самое свежее
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 45, endIndex: 110 },
      })
    ).toBe('msg-3');
  });

  it('удерживает показанное закрепление, пока оно на экране', () => {
    // После клика по плашке лента встала на pin2, в том же кадре виден pin3
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 40, endIndex: 95 },
        currentId: 'msg-2',
      })
    ).toBe('msg-2');

    // pin2 ушёл с экрана — плашка переходит на видимый pin3
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 55, endIndex: 95 },
        currentId: 'msg-2',
      })
    ).toBe('msg-3');
  });

  it('не считает видимым закрепление сразу за краем экрана', () => {
    // pin2 (50) в пяти строках ниже окна 20..45 — в overscan виртуализатора,
    // но не на экране: активен пройденный pin1
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 20, endIndex: 45 },
      })
    ).toBe('msg-1');
  });

  it('выбирает ближайший пройденный пин выше экрана, если на экране нет закреплений', () => {
    // Скролл между Pin 1 (10) и Pin 2 (50): видимы строки 25..35
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 25, endIndex: 35 },
      })
    ).toBe('msg-1');

    // Скролл между Pin 2 (50) и Pin 3 (90): видимы строки 65..75
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 65, endIndex: 75 },
      })
    ).toBe('msg-2');

    // Скролл в самом низу ленты после Pin 3 (90): видимы строки 100..110
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 100, endIndex: 110 },
      })
    ).toBe('msg-3');
  });

  it('удерживает первый пин при скролле выше всех закреплений', () => {
    // Видимы строки 0..5 (выше Pin 1 на индексе 10)
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin1, pin2, pin3],
        feedItems,
        visibleRange: { startIndex: 0, endIndex: 5 },
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
        visibleRange: { startIndex: 20, endIndex: 20 }, // до pin2 (50)
      })
    ).toBe('msg-older');
  });

  it('корректно выбирает ближайший пройденный пин при неотсортированном pinnedMessages (#1057)', () => {
    // Пины в неотсортированном порядке (например, после слияния shared и personal)
    // Pin 1 = feedIndex 10, Pin 2 = feedIndex 50, Pin 3 = feedIndex 90
    const unsortedPins = [pin3, pin1, pin2];

    // Скролл в диапазоне 65..75: пройдены pin1 (10) и pin2 (50).
    // Ближайший к экрану — pin2 (индекс 50), независимо от позиции в массиве pinnedMessages.
    expect(
      findActivePinnedMessageId({
        pinnedMessages: unsortedPins,
        feedItems,
        visibleRange: { startIndex: 65, endIndex: 75 },
      })
    ).toBe('msg-2');
  });

  it('выше всех закреплений удерживает самое раннее в истории, а не первое в массиве', () => {
    expect(
      findActivePinnedMessageId({
        pinnedMessages: [pin3, pin2, pin1],
        feedItems,
        visibleRange: { startIndex: 0, endIndex: 5 },
      })
    ).toBe('msg-1');
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
      ({ visibleRange }) =>
        usePinnedScrollTracker({
          pinnedMessages: [pin1, pin2],
          feedItems,
          visibleRange,
        }),
      { initialProps: { visibleRange: { startIndex: 0, endIndex: 0 } } }
    );

    expect(useChatUiStore.getState().activePinnedId).toBe('m-1');

    rerender({ visibleRange: { startIndex: 1, endIndex: 1 } });
    expect(useChatUiStore.getState().activePinnedId).toBe('m-2');
  });

  it('игнорирует обновления от скролла при активном pinnedNavLockUntil', () => {
    useChatUiStore.getState().setActivePinnedId('m-1');
    useChatUiStore.getState().setPinnedNavLockUntil(Date.now() + 5000);

    renderHook(() =>
      usePinnedScrollTracker({
        pinnedMessages: [pin1, pin2],
        feedItems,
        visibleRange: { startIndex: 1, endIndex: 1 },
      })
    );

    // activePinnedId остался 'm-1', так как лок заблокировал изменение
    expect(useChatUiStore.getState().activePinnedId).toBe('m-1');
  });

  it('после клика ждёт, пока цель окажется на экране, и затем удерживает её', () => {
    const pin3 = makePin({ messageId: 'm-3', message: makeMessage({ id: 'm-3' }) });
    const filler = (id: string): TFeedItem => ({
      id,
      type: 'message',
      message: makeMessage({ id }),
      isFirstInGroup: true,
      isLastInGroup: true,
      isDifferentAuthor: false,
    });
    // m-1 (0), m-2 (1), пять строк, m-3 (7)
    const items: TFeedItem[] = [
      ...feedItems,
      ...['f-1', 'f-2', 'f-3', 'f-4', 'f-5'].map(filler),
      {
        id: 'm-3',
        type: 'message',
        message: pin3.message,
        isFirstInGroup: true,
        isLastInGroup: true,
        isDifferentAuthor: false,
      },
    ];
    // Клик по плашке выбрал m-3, лента только начала ехать
    useChatUiStore.getState().setActivePinnedId('m-3');
    useChatUiStore.getState().setPinnedNavLockUntil(Date.now() + 5000);

    const { rerender } = renderHook(
      ({ visibleRange }) =>
        usePinnedScrollTracker({
          pinnedMessages: [pin1, pin2, pin3],
          feedItems: items,
          visibleRange,
        }),
      { initialProps: { visibleRange: { startIndex: 0, endIndex: 3 } } }
    );
    // По пути видны m-1 и m-2 — плашка остаётся на цели
    expect(useChatUiStore.getState().activePinnedId).toBe('m-3');

    // Доехали: цель и m-2 в одном кадре — удерживается цель
    rerender({ visibleRange: { startIndex: 1, endIndex: 7 } });
    expect(useChatUiStore.getState().activePinnedId).toBe('m-3');

    // Человек прокрутил вверх, цель ушла с экрана — трекер снова ведёт плашку
    rerender({ visibleRange: { startIndex: 0, endIndex: 4 } });
    expect(useChatUiStore.getState().activePinnedId).toBe('m-2');
  });

  it('сбрасывает activePinnedId в null при пустом списке пинов', () => {
    useChatUiStore.getState().setActivePinnedId('m-1');

    renderHook(() =>
      usePinnedScrollTracker({
        pinnedMessages: [],
        feedItems,
        visibleRange: { startIndex: 0, endIndex: 0 },
      })
    );

    expect(useChatUiStore.getState().activePinnedId).toBeNull();
  });
});
