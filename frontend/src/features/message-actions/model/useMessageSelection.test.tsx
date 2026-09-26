import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatUiStore } from '@/entities/chat';
import { MAX_MESSAGES_PER_SEND } from '@/shared/config';
import { clearToasts, getToasts } from '@/shared/ui';
import { makeMessage } from '@/test/fixtures';
import { testI18n } from '@/test/harness/i18n';
import { useMessageSelection } from './useMessageSelection';

function wrapper({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>;
}

describe('выделение сообщений', () => {
  beforeEach(() => {
    useChatUiStore.getState().resetChatState();
    clearToasts();
  });

  it('снимает и ставит отметку', () => {
    const message = makeMessage();
    const { result } = renderHook(() => useMessageSelection([message], null), { wrapper });

    act(() => result.current.toggleMessageSelection(message));
    expect(useChatUiStore.getState().selectedMessages).toEqual([message]);

    act(() => result.current.toggleMessageSelection(message));
    expect(useChatUiStore.getState().selectedMessages).toEqual([]);
  });

  it('не даёт выделить больше, чем уйдёт одной отправкой (#808)', () => {
    const selected = Array.from({ length: MAX_MESSAGES_PER_SEND }, () => makeMessage());
    useChatUiStore.getState().setSelectedMessages(selected);
    const extra = makeMessage();
    const { result } = renderHook(() => useMessageSelection([...selected, extra], null), {
      wrapper,
    });

    act(() => result.current.toggleMessageSelection(extra));

    expect(useChatUiStore.getState().selectedMessages).toHaveLength(MAX_MESSAGES_PER_SEND);
    expect(getToasts()).toEqual([
      expect.objectContaining({
        type: 'info',
        message: `Можно выбрать не больше ${MAX_MESSAGES_PER_SEND} сообщений`,
      }),
    ]);

    // Снять отметку при этом можно.
    act(() => result.current.toggleMessageSelection(selected[0]));
    expect(useChatUiStore.getState().selectedMessages).toHaveLength(MAX_MESSAGES_PER_SEND - 1);
  });
});
