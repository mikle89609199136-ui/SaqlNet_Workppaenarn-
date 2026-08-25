import { useChatStore, useProfileStore } from '@/store';
import type { IMessageDto } from '@/types';
import { useEffect, type RefObject } from 'react';

export function useComposerShortcuts(
  draftRef: RefObject<HTMLInputElement | null>,
  formRef: RefObject<HTMLFormElement | null>
) {
  const draft = useChatStore((state) => state.draft);
  const editingMessage = useChatStore((state) => state.editingMessage);
  const replyToMessage = useChatStore((state) => state.replyToMessage);
  const messages = useChatStore((state) => state.messages);
  const setDraft = useChatStore((state) => state.setDraft);
  const setEditingMessage = useChatStore((state) => state.setEditingMessage);
  const setReplyToMessage = useChatStore((state) => state.setReplyToMessage);
  const user = useProfileStore((state) => state.user);

  function startEdit(message: IMessageDto) {
    setEditingMessage(message);
    setReplyToMessage(null);
    setDraft(message.content || '');
    draftRef.current?.focus();
  }

  function cancelComposerMode() {
    setEditingMessage(null);
    setReplyToMessage(null);
    setDraft('');
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

      if (event.key !== 'ArrowUp' || draft.trim() || editingMessage || replyToMessage) return;
      const lastOwnMessage = [...messages].reverse().find((m) => m.senderId === user?.id);
      if (!lastOwnMessage) return;

      event.preventDefault();
      startEdit(lastOwnMessage);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draft, editingMessage, replyToMessage, messages, user?.id]);

  return { cancelComposerMode };
}
