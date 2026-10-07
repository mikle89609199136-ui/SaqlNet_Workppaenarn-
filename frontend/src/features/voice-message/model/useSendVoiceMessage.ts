import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { chatKeys, useChatUiStore } from '@/entities/chat';
import {
  addOutboxItem,
  putThreadMessage,
  sendOutboxItem,
  type IOutboxItem,
} from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { describeApiError } from '@/shared/api';
import type { IMediaItem } from '@/types';
import type { IVoiceRecording } from './voiceRecorder';

/**
 * Отправка записанного голосового (#843) — тем же путём, что вложения:
 * пузырь сразу в ленте, файл шифруется и грузится из очереди, при сбое —
 * «не отправлено» и повтор. Длительность и волна видны в пузыре сразу и
 * уезжают только внутри шифрованного конверта.
 */
export function useSendVoiceMessage(chatId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const senderId = useProfileStore((state) => state.user?.id ?? '');
  const replyToMessage = useChatUiStore((state) => state.replyToMessage);
  const setReplyToMessage = useChatUiStore((state) => state.setReplyToMessage);
  const setError = useChatUiStore((state) => state.setError);

  return useCallback(
    (recording: IVoiceRecording) => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const now = new Date();
      let blobUrl: string | undefined;
      try {
        blobUrl = URL.createObjectURL(recording.blob);
      } catch {
        // Вне браузера адреса нет: пузырь покажется без плеера до ответа.
      }

      const optimistic: IMediaItem = {
        id: tempId,
        tempId,
        chatId,
        senderId,
        senderFirstName: '',
        senderName: '',
        forwardedSenderName: '',
        replySenderName: null,
        replyToSenderName: null,
        content: '',
        entities: [],
        type: 'voice',
        mediaType: 'voice',
        mediaUrl: blobUrl,
        voice: recording.meta,
        replyTo: replyToMessage?.id ?? null,
        replyToMessageId: replyToMessage?.id ?? null,
        status: 'uploading',
        createdAt: now,
        updatedAt: now,
        isEdited: false,
        isForwarded: false,
        isPinned: false,
        reactions: [],
      };
      const item: IOutboxItem = {
        tempId,
        chatId,
        content: '',
        type: 'voice',
        file: recording.blob,
        voice: recording.meta,
        replyToId: replyToMessage?.id ?? null,
        status: 'uploading',
        blobUrl,
        createdAt: now,
      };

      putThreadMessage(queryClient, chatId, optimistic);
      addOutboxItem(item);
      setReplyToMessage(null);
      setError('');

      void sendOutboxItem(queryClient, item, {
        onError: (err) => {
          const error = err as { code?: string };
          if (error?.code === 'blocked_by_user') {
            void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId), exact: true });
          }
          setError(
            describeApiError(error, t, t('voice.sendError', 'Не удалось отправить голосовое'))
          );
        },
      });
    },
    [chatId, queryClient, replyToMessage, senderId, setError, setReplyToMessage, t]
  );
}
