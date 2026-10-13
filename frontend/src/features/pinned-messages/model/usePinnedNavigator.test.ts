import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeMessage, makePin } from '@/test/fixtures';
import { useChatUiStore } from '@/entities/chat';
import { usePinnedNavigator } from './usePinnedNavigator';

describe('usePinnedNavigator', () => {
  beforeEach(() => {
    useChatUiStore.getState().resetChatState();
  });

  it('should calculate safe index, segment counts and initial state correctly', () => {
    const pin1 = makePin({ message: makeMessage({ id: 'msg-1', senderFirstName: 'Иван' }) });
    const pin2 = makePin({ message: makeMessage({ id: 'msg-2', senderFirstName: 'Мария' }) });

    const { result } = renderHook(() => usePinnedNavigator([pin1, pin2]));

    expect(result.current.safeIndex).toBe(1);
    expect(result.current.currentMessage?.id).toBe('msg-2');
    expect(result.current.senderTitle).toBe('Мария');
    expect(result.current.currentMessageNumber).toBe(2);
    expect(result.current.isFilling).toBe(true);
    expect(result.current.visibleSegments).toBe(2);
  });

  it('should handle many pinned messages with sliding window', () => {
    const pins = Array.from({ length: 10 }, (_, i) =>
      makePin({ message: makeMessage({ id: `msg-${i + 1}` }) })
    );

    const { result } = renderHook(() => usePinnedNavigator(pins));

    expect(result.current.safeIndex).toBe(9);
    expect(result.current.isFilling).toBe(false);
    expect(result.current.visibleSegments).toBe(4);
    expect(result.current.windowStart).toBe(6);
  });

  it('should cycle through messages and emit jumpRequest on handleClick', () => {
    const pin1 = makePin({ message: makeMessage({ id: 'msg-1' }) });
    const pin2 = makePin({ message: makeMessage({ id: 'msg-2' }) });

    const { result } = renderHook(() => usePinnedNavigator([pin1, pin2]));

    act(() => {
      result.current.handleClick();
    });

    expect(useChatUiStore.getState().jumpRequest).toEqual({
      chatId: pin2.message.chatId,
      messageId: 'msg-2',
    });
    expect(result.current.safeIndex).toBe(0);
    expect(result.current.currentMessage?.id).toBe('msg-1');

    act(() => {
      result.current.handleClick();
    });

    expect(useChatUiStore.getState().jumpRequest).toEqual({
      chatId: pin1.message.chatId,
      messageId: 'msg-1',
    });
    expect(result.current.safeIndex).toBe(1);
  });
});
