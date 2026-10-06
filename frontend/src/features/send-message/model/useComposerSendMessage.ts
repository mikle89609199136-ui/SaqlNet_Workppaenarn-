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
  pendingAttachments: IPendingAttachment[];
  setPendingAttachments: Dispatch<SetStateAction<IPendingAttachment[]>>;
  bottomRef: RefObject<HTMLDivElement | null>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
}

export function useComposerSendMessage({
  attachmentInputRef,
  bottomRef,
  draftRef,
  pendingAttachments,
  selectionMode,
  setPendingAttachments,
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
    if (!content && pendingAttachments.length === 0) return;

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

    /* Оптимистичная отправка: сообщения в ленте появляются мгновенно.
       Несколько вложений — по сообщению на каждое, пока нет альбомов:
       подпись и ответ — у первого, как у альбома в Telegram. */
    const attachments: (IPendingAttachment | null)[] =
      pendingAttachments.length > 0 ? pendingAttachments : [null];
    const startedAt = Date.now();

    const outboxItems = attachments.map((attachment, index): IOutboxItem => {
      const tempId = `temp-${startedAt}-${index}-${Math.random().toString(36).slice(2, 9)}`;
      const first = index === 0;
      let blobUrl: string | undefined;
      if (attachment?.file) {
        try {
          blobUrl = URL.createObjectURL(attachment.file);
        } catch {
          // Игнорируем ошибку создания Object URL вне браузера
        }
      }
      // Миллисекунда разницы держит порядок вложений в ленте.
      const createdAt = new Date(startedAt + index);
      const type = attachment ? attachment.type : 'text';
      const status = attachment ? 'uploading' : 'pending';
      const itemContent = first ? content : '';
      const itemEntities = first ? entities : [];
      const replyToId = first ? replyToMessage?.id : undefined;

      const optimisticMessage: IMediaItem = {
        id: tempId,
        tempId,
        chatId,
        senderId: currentUser?.id ?? '',
        content: itemContent,
        entities: itemEntities,
        type,
        mediaType: attachment ? attachment.type : undefined,
        mediaUrl: blobUrl,
        replyTo: replyToId,
        replyToMessageId: replyToId,
        status,
        createdAt,
        reactions: [],
      };
      putThreadMessage(queryClient, chatId, optimisticMessage);

      const outboxItem: IOutboxItem = {
        tempId,
        chatId,
        content: itemContent,
        entities: itemEntities,
        type,
        file: attachment?.file,
        replyToId: replyToId ?? null,
        status,
        blobUrl,
        createdAt,
      };
      addOutboxItem(outboxItem);
      return outboxItem;
    });
    scrollToBottom();

    // Мгновенно очищаем композер, не блокируя набор следующих сообщений
    draftRef.current?.clear();
    clearDraft(chatId);
    setPendingAttachments([]);
    setReplyToMessage(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    setError('');

    // Отправка в фоне — по одному, чтобы у собеседника порядок был тот же.
    // Сбой одного не останавливает остальные: он ждёт повтора в очереди.
    void (async () => {
      for (const outboxItem of outboxItems) {
        await sendOutboxItem(queryClient, outboxItem, {
          onError: (err) => {
            showSendError(err);
          },
          onSuccess: () => {
            setError('');
          },
        });
      }
    })();
  }

  const sendSticker = useCallback(
    async (stickerUrl: string) => {
      const tempId = `temp-${Date.now()}-0-${Math.random().toString(36).slice(2, 9)}`;
      const replyToId = replyToMessage?.id ?? null;
      const optimisticMessage: IMediaItem = {
        id: tempId,
        tempId,
        chatId,
        senderId: currentUser?.id ?? '',
        content: '',
        type: 'sticker',
        mediaType: 'sticker',
        mediaUrl: stickerUrl,
        replyTo: replyToId,
        replyToMessageId: replyToId,
        status: 'pending',
        createdAt: new Date(),
        reactions: [],
      };
      putThreadMessage(queryClient, chatId, optimisticMessage);

      const outboxItem: IOutboxItem = {
        tempId,
        chatId,
        content: '',
        type: 'sticker',
        mediaUrl: stickerUrl,
        replyToId,
        status: 'pending',
        createdAt: new Date(),
      };
      addOutboxItem(outboxItem);
      setReplyToMessage(null);
      scrollToBottom();

      await sendOutboxItem(queryClient, outboxItem, {
        onError: (err) => showSendError(err),
        onSuccess: () => setError(''),
      });
    },
    [
      chatId,
      currentUser?.id,
      queryClient,
      replyToMessage?.id,
      scrollToBottom,
      setError,
      setReplyToMessage,
      showSendError,
    ]
  );

  const sendGif = useCallback(
    async (gifUrl: string) => {
      const tempId = `temp-${Date.now()}-0-${Math.random().toString(36).slice(2, 9)}`;
      const replyToId = replyToMessage?.id ?? null;
      const optimisticMessage: IMediaItem = {
        id: tempId,
        tempId,
        chatId,
        senderId: currentUser?.id ?? '',
        content: '',
        type: 'gif',
        mediaType: 'gif',
        mediaUrl: gifUrl,
        replyTo: replyToId,
        replyToMessageId: replyToId,
        status: 'pending',
        createdAt: new Date(),
        reactions: [],
      };
      putThreadMessage(queryClient, chatId, optimisticMessage);

      const outboxItem: IOutboxItem = {
        tempId,
        chatId,
        content: '',
        type: 'gif',
        mediaUrl: gifUrl,
        replyToId,
        status: 'pending',
        createdAt: new Date(),
      };
      addOutboxItem(outboxItem);
      setReplyToMessage(null);
      scrollToBottom();

      await sendOutboxItem(queryClient, outboxItem, {
        onError: (err) => showSendError(err),
        onSuccess: () => setError(''),
      });
    },
    [
      chatId,
      currentUser?.id,
      queryClient,
      replyToMessage?.id,
      scrollToBottom,
      setError,
      setReplyToMessage,
      showSendError,
    ]
  );

  return { isSending, handleSubmit, handleRetryMessage, sendSticker, sendGif };
}
