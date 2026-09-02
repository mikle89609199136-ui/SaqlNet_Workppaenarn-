import { chatKeys } from '@/queries/keys';
import { patchThreadMessage, putThreadMessage } from '@/queries/chat/threadCacheActions';
import { services } from '@/services';
import { useChatUiStore } from '@/store';
import { setComposerText } from '@/utils/setComposerText';
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
  draftRef: RefObject<HTMLInputElement | null>;
  pendingAttachment: IPendingAttachment | null;
  setPendingAttachment: Dispatch<SetStateAction<IPendingAttachment | null>>;
  bottomRef: RefObject<HTMLDivElement | null>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
}

export function useComposerSendMessage({
  attachmentInputRef,
  bottomRef,
  draftRef,
  pendingAttachment,
  selectionMode,
  setPendingAttachment,
}: Params) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const editingMessage = useChatUiStore((state) => state.editingMessage);
  const setEditingMessage = useChatUiStore((state) => state.setEditingMessage);
  const replyToMessage = useChatUiStore((state) => state.replyToMessage);
  const setReplyToMessage = useChatUiStore((state) => state.setReplyToMessage);
  const setError = useChatUiStore((state) => state.setError);
  const { chatId = '' } = useParams<{ chatId: string }>();

  const [isSending, setIsSending] = useState(false);

  function scrollToBottom() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectionMode) return;
    // Текст берётся из самого поля: в состоянии React его больше нет.
    const content = (draftRef.current?.value ?? '').trim();
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
      setComposerText(draftRef.current, '');
      setError('');
    } catch (err: any) {
      setError(err.message || t('messageSendError', 'Не удалось отправить сообщение'));
    } finally {
      setIsSending(false);
    }
  }

  return { isSending, handleSubmit };
}
