import { chatKeys } from '@/queries/keys';
import { patchThreadMessage, putThreadMessage } from '@/queries/chat/threadCacheActions';
import { services } from '@/services';
import { useChatStore } from '@/store';
import type { IPendingAttachment } from '@/types';
import { useQueryClient } from '@tanstack/react-query';
import {
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type SubmitEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

interface Params {
  selectionMode: boolean;
  pendingAttachment: IPendingAttachment | null;
  setPendingAttachment: Dispatch<SetStateAction<IPendingAttachment | null>>;
  bottomRef: RefObject<HTMLDivElement | null>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
}

export function useComposerSendMessage({
  attachmentInputRef,
  bottomRef,
  pendingAttachment,
  selectionMode,
  setPendingAttachment,
}: Params) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const draft = useChatStore((state) => state.draft);
  const setDraft = useChatStore((state) => state.setDraft);
  const editingMessage = useChatStore((state) => state.editingMessage);
  const setEditingMessage = useChatStore((state) => state.setEditingMessage);
  const replyToMessage = useChatStore((state) => state.replyToMessage);
  const setReplyToMessage = useChatStore((state) => state.setReplyToMessage);
  const setError = useChatStore((state) => state.setError);
  const { chatId = '' } = useParams<{ chatId: string }>();

  const [isSending, setIsSending] = useState(false);

  function scrollToBottom() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectionMode) return;
    const content = draft.trim();
    if ((!content && !pendingAttachment) || isSending) return;

    setIsSending(true);
    try {
      if (editingMessage) {
        const result = await services.messageService.editMessage(
          editingMessage.id,
          chatId,
          content
        );

        patchThreadMessage(queryClient, chatId, editingMessage.id, {
          content: result.content,
          updatedAt: result.updatedAt,
          isEdited: true,
        });
        // Закреплённая копия того же сообщения живёт отдельным запросом.
        void queryClient.invalidateQueries({ queryKey: chatKeys.pins(chatId) });
        setEditingMessage(null);
      } else if (pendingAttachment) {
        const message = await services.messageService.sendMediaMessage(
          chatId,
          pendingAttachment.file,
          pendingAttachment.type,
          content,
          replyToMessage?.id
        );

        putThreadMessage(queryClient, chatId, message);
        scrollToBottom();
        setPendingAttachment(null);
        setReplyToMessage(null);
        if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      } else {
        const message = await services.messageService.sendMessage(
          chatId,
          content,
          'text',
          replyToMessage?.id
        );

        putThreadMessage(queryClient, chatId, message);
        scrollToBottom();
        setReplyToMessage(null);
      }
      setDraft('');
      setError('');
    } catch (err: any) {
      setError(err.message || t('messageSendError', 'Не удалось отправить сообщение'));
    } finally {
      setIsSending(false);
    }
  }

  return { isSending, handleSubmit };
}
