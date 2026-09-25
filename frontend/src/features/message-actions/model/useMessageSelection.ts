import { useChatUiStore, type IActionMenu } from '@/entities/chat';
import type { IMessageDto, TMessagesList } from '@/types';
import { useCallback, useMemo } from 'react';

export function useMessageSelection(messages: TMessagesList, actionMenu: IActionMenu | null) {
  const setSelectedMessages = useChatUiStore((state) => state.setSelectedMessages);
  const setSelectionMode = useChatUiStore((state) => state.setSelectionMode);

  const toggleMessageSelection = useCallback(
    (message: IMessageDto) => {
      setSelectedMessages((items) => {
        const isSelected = items.some(({ id }) => id === message.id);

        if (!isSelected) return [...items, message];

        const next = items.filter(({ id }) => id !== message.id);
        if (next.length === 0) setSelectionMode(false);

        return next;
      });
    },
    [setSelectedMessages, setSelectionMode]
  );

  const selectedActionMessage = useMemo(
    () =>
      actionMenu ? (messages.find((message) => message.id === actionMenu.messageId) ?? null) : null,
    [actionMenu, messages]
  );

  return { toggleMessageSelection, selectedActionMessage };
}
