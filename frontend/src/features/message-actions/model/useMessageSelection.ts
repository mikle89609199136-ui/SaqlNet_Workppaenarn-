import { useChatUiStore, type IActionMenu } from '@/entities/chat';
import { MAX_MESSAGES_PER_SEND } from '@/shared/config';
import { showToast } from '@/shared/ui';
import type { IMessageDto, TMessagesList } from '@/types';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function useMessageSelection(messages: TMessagesList, actionMenu: IActionMenu | null) {
  const { t } = useTranslation();
  const setSelectedMessages = useChatUiStore((state) => state.setSelectedMessages);
  const setSelectionMode = useChatUiStore((state) => state.setSelectionMode);

  const toggleMessageSelection = useCallback(
    (message: IMessageDto) => {
      const items = useChatUiStore.getState().selectedMessages;
      const isSelected = items.some(({ id }) => id === message.id);

      if (!isSelected) {
        // Выделенное пересылают одной отправкой, а у неё есть предел (#808).
        if (items.length >= MAX_MESSAGES_PER_SEND) {
          showToast(
            'info',
            t('selectionLimitReached', {
              count: MAX_MESSAGES_PER_SEND,
              defaultValue: 'Можно выбрать не больше {{count}} сообщений',
            })
          );
          return;
        }

        setSelectedMessages([...items, message]);
        return;
      }

      const next = items.filter(({ id }) => id !== message.id);
      if (next.length === 0) setSelectionMode(false);
      setSelectedMessages(next);
    },
    [setSelectedMessages, setSelectionMode, t]
  );

  const selectedActionMessage = useMemo(
    () =>
      actionMenu ? (messages.find((message) => message.id === actionMenu.messageId) ?? null) : null,
    [actionMenu, messages]
  );

  return { toggleMessageSelection, selectedActionMessage };
}
