import { describeApiError } from '@/shared/api';
import { chatKeys } from '@/entities/chat';
import {
  addOutboxItem,
  patchThreadMessage,
  putThreadMessage,
  retryOutboxMessage,
  sendOutboxItem,
  type IOutboxItem,
} from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services';
import { clearDraft, useChatUiStore } from '@/entities/chat';
import { trimRichText } from '@/shared/lib/richText';
import type { IRichTextInputHandle } from '@/shared/ui';
import type { IMediaItem, IMessageDto, IPendingAttachment } from '@/types';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
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
  draftRef: RefObject<IRichTextInputHandle | null>;
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
  const currentUser = useProfileStore((state) => state.user);
  const { chatId = '' } = useParams<{ chatId: string }>();

  const [isSending, setIsSending] = useState(false);

  /* Ошибка отправки — человеку словами. blocked_by_user значит, что
     собеседник заблокировал, а событие об этом могло не дойти: чат
     перечитывается, и вместо поля ввода встаёт плашка (#760). */
  const showSendError = useCallback(
    (err: unknown) => {
      const error = err as { code?: string; message?: string };
      if (error?.code === 'blocked_by_user') {
        void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId), exact: true });
      }
      setError(describeApiError(error, t, t('messageSendError', 'Не удалось отправить сообщение')));
    },
    [chatId, queryClient, setError, t]
  );

  function scrollToBottom() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }

  const handleRetryMessage = useCallback(
    (message: IMessageDto) => {
      setError('');
      void retryOutboxMessage(queryClient, message.tempId || message.id, {
        onError: (err) => {
          showSendError(err);
        },
        onSuccess: () => {
          setError('');
        },
      });
    },
    [queryClient, setError, showSendError]
  );

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectionMode) return;
    // Текст с форматированием; пробелы по краям срезаются вместе с
    // диапазонами (#656).
    const { text: content, entities } = trimRichText(
      draftRef.current?.getValue() ?? { text: '', entities: [] }
    );
    if (!content && !pendingAttachment) return;

    if (editingMessage) {
      if (isSending) return;
      setIsSending(true);
      try {
        const result = await services.messageService.editMessage(
          editingMessage.id,
          chatId,
          content,
          entities
        );

        patchThreadMessage(queryClient, chatId, editingMessage.id, {
          content: result.content,
          entities: result.entities,
          updatedAt: result.updatedAt,
          isEdited: true,
        });
        void queryClient.invalidateQueries({ queryKey: chatKeys.pins(chatId) });
        setEditingMessage(null);
        draftRef.current?.clear();
        setError('');
      } catch (err: unknown) {
        showSendError(err);
      } finally {
        setIsSending(false);
      }
      return;
    }

    // Оптимистичная отправка: создаём сообщение в ленте мгновенно
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    let blobUrl: string | undefined;

    if (pendingAttachment?.file) {
      try {
        blobUrl = URL.createObjectURL(pendingAttachment.file);
      } catch {
        // Игнорируем ошибку создания Object URL вне браузера
      }
    }

    const now = new Date();

    const optimisticMessage: IMediaItem = {
      id: tempId,
      tempId,
      chatId,
      senderId: currentUser?.id ?? '',
      content,
      entities,
      type: pendingAttachment ? pendingAttachment.type : 'text',
      mediaType: pendingAttachment ? pendingAttachment.type : undefined,
      mediaUrl: blobUrl,
      replyTo: replyToMessage?.id,
      replyToMessageId: replyToMessage?.id,
      status: pendingAttachment ? 'uploading' : 'pending',
      createdAt: now,
      reactions: [],
    };

    const outboxItem: IOutboxItem = {
      tempId,
      chatId,
      content,
      entities,
      type: pendingAttachment ? pendingAttachment.type : 'text',
      file: pendingAttachment?.file,
      replyToId: replyToMessage?.id ?? null,
      status: pendingAttachment ? 'uploading' : 'pending',
      blobUrl,
      createdAt: now,
    };

    // 1. Помещаем в кеш TanStack Query и в Outbox store
    putThreadMessage(queryClient, chatId, optimisticMessage);
    addOutboxItem(outboxItem);
    scrollToBottom();

    // 2. Мгновенно очищаем композер, не блокируя набор следующих сообщений
    draftRef.current?.clear();
    clearDraft(chatId);
    setPendingAttachment(null);
    setReplyToMessage(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    setError('');

    // 3. Отправляем в фоне через outboxSender
    void sendOutboxItem(queryClient, outboxItem, {
      onError: (err) => {
        showSendError(err);
      },
      onSuccess: () => {
        setError('');
      },
    });
  }

  return { isSending, handleSubmit, handleRetryMessage };
}
