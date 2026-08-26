import { useThreadMessagesData } from '@/queries/chat/useThreadMessagesData';
import { useChatUiStore, useProfileStore } from '@/store';
import { setComposerText } from '@/utils/setComposerText';
import type { IMessageDto } from '@/types';
import { useEffect, type RefObject } from 'react';

export function useComposerShortcuts(
  draftRef: RefObject<HTMLInputElement | null>,
  formRef: RefObject<HTMLFormElement | null>
) {
  const editingMessage = useChatUiStore((state) => state.editingMessage);
  const replyToMessage = useChatUiStore((state) => state.replyToMessage);
  const setEditingMessage = useChatUiStore((state) => state.setEditingMessage);
  const setReplyToMessage = useChatUiStore((state) => state.setReplyToMessage);
  const user = useProfileStore((state) => state.user);
  const messages = useThreadMessagesData();

  function startEdit(message: IMessageDto) {
    setEditingMessage(message);
    setReplyToMessage(null);
    setComposerText(draftRef.current, message.content || '');
    draftRef.current?.focus();
  }

  function cancelComposerMode() {
    setEditingMessage(null);
    setReplyToMessage(null);
    setComposerText(draftRef.current, '');
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && (editingMessage || replyToMessage)) {
        event.preventDefault();
        cancelComposerMode();
        return;
      }

      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        formRef.current?.requestSubmit();
        return;
      }

      // Пустое поле читается из самого элемента: текста в состоянии React
      // больше нет, и это к лучшему — раньше слушатель клавиш
      // переустанавливался на каждый набранный символ.
      const пусто = !draftRef.current?.value.trim();
      if (event.key !== 'ArrowUp' || !пусто || editingMessage || replyToMessage) return;
      const lastOwnMessage = [...messages].reverse().find((m) => m.senderId === user?.id);
      if (!lastOwnMessage) return;

      event.preventDefault();
      startEdit(lastOwnMessage);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingMessage, replyToMessage, messages, user?.id]);

  return { cancelComposerMode };
}
