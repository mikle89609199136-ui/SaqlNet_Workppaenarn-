import { useThreadMessagesData } from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { useChatUiStore } from '@/entities/chat';
import { setComposerText } from '@/shared/lib/setComposerText';
import type { IMessageDto } from '@/types';
import { useCallback, useEffect, type RefObject } from 'react';

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

  /* Обе обёрнуты в useCallback ради подписки ниже: без этого они новые
     на каждый рендер, и слушатель клавиш пришлось бы переустанавливать
     следом. Их собственные зависимости стабильны — сеттеры хранилища и
     ссылка на поле. */
  const startEdit = useCallback(
    (message: IMessageDto) => {
      setEditingMessage(message);
      setReplyToMessage(null);
      setComposerText(draftRef.current, message.content || '');
      draftRef.current?.focus();
    },
    [draftRef, setEditingMessage, setReplyToMessage]
  );

  const cancelComposerMode = useCallback(() => {
    setEditingMessage(null);
    setReplyToMessage(null);
    setComposerText(draftRef.current, '');
  }, [draftRef, setEditingMessage, setReplyToMessage]);

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
      const isEmpty = !draftRef.current?.value.trim();
      if (event.key !== 'ArrowUp' || !isEmpty || editingMessage || replyToMessage) return;
      const lastOwnMessage = [...messages].reverse().find((m) => m.senderId === user?.id);
      if (!lastOwnMessage) return;

      event.preventDefault();
      startEdit(lastOwnMessage);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    cancelComposerMode,
    draftRef,
    editingMessage,
    formRef,
    messages,
    replyToMessage,
    startEdit,
    user?.id,
  ]);

  return { cancelComposerMode };
}
