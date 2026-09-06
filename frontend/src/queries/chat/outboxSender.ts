import type { QueryClient } from '@tanstack/react-query';
import { services } from '@/services';
import type { TMediaMessageType } from '@/types';
import {
  patchThreadMessage,
  replaceThreadMessage,
} from './threadCacheActions';
import {
  type IOutboxItem,
  removeOutboxItem,
  updateOutboxItem,
  getOutboxItem,
  getRetryableOutboxItems,
} from '@/store/outbox';

/** Множество ID сообщений, находящихся в процессе отправки, для защиты от повторных параллельных вызовов. */
const inFlightTempIds = new Set<string>();

export interface ISendOutboxCallbacks {
  onError?: (err: unknown) => void;
  onSuccess?: () => void;
}

/**
 * Отправка сообщения из Outbox.
 *
 * Если сообщение с медиа-вложением — переводит статус в uploading/encrypting
 * и вызывает `sendMediaMessage`. Для текстового сообщения — `sendMessage`.
 *
 * При успехе: заменяет оптимистичное сообщение в кеше на ответ сервера и удаляет
 * элемент из Outbox.
 * При ошибке: помечает сообщение статусом `failed`, сохраняя полезную нагрузку
 * в Outbox для возможности повтора в 1 клик.
 */
export async function sendOutboxItem(
  queryClient: QueryClient,
  item: IOutboxItem,
  callbacks?: ISendOutboxCallbacks
): Promise<void> {
  if (inFlightTempIds.has(item.tempId)) return;
  inFlightTempIds.add(item.tempId);

  try {
    if (item.file) {
      patchThreadMessage(queryClient, item.chatId, item.tempId, {
        status: 'uploading',
        uploadProgress: 25,
      });
      patchThreadMessage(queryClient, item.chatId, item.tempId, {
        status: 'encrypting',
        uploadProgress: 60,
      });

      const message = await services.messageService.sendMediaMessage(
        item.chatId,
        item.file,
        item.type as TMediaMessageType,
        item.content,
        item.replyToId ?? null
      );

      patchThreadMessage(queryClient, item.chatId, item.tempId, {
        status: 'sent',
        uploadProgress: 100,
      });
      replaceThreadMessage(queryClient, item.chatId, item.tempId, message);
      removeOutboxItem(item.tempId);
    } else {
      patchThreadMessage(queryClient, item.chatId, item.tempId, {
        status: 'pending',
      });

      const message = await services.messageService.sendMessage(
        item.chatId,
        item.content,
        'text',
        item.replyToId ?? null
      );

      replaceThreadMessage(queryClient, item.chatId, item.tempId, message);
      removeOutboxItem(item.tempId);
    }
    callbacks?.onSuccess?.();
  } catch (err: unknown) {
    patchThreadMessage(queryClient, item.chatId, item.tempId, {
      status: 'failed',
    });
    updateOutboxItem(item.tempId, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Send failed',
    });
    callbacks?.onError?.(err);
  } finally {
    inFlightTempIds.delete(item.tempId);
  }
}

/**
 * Повторная отправка сообщения из очереди Outbox по клику на кнопку Retry.
 */
export async function retryOutboxMessage(
  queryClient: QueryClient,
  targetId: string,
  callbacks?: ISendOutboxCallbacks
): Promise<void> {
  const item = getOutboxItem(targetId);
  if (!item) return;

  patchThreadMessage(queryClient, item.chatId, item.tempId, {
    status: item.file ? 'uploading' : 'pending',
    uploadProgress: item.file ? 0 : undefined,
  });
  updateOutboxItem(item.tempId, {
    status: item.file ? 'uploading' : 'pending',
    error: undefined,
  });

  await sendOutboxItem(queryClient, item, callbacks);
}

/**
 * Автоматический перезапуск отправки всех зависших/ошибочных сообщений
 * (например, при восстановлении сети или сокета).
 */
export function retryAllOutboxMessages(
  queryClient: QueryClient,
  chatId?: string
): void {
  const retryable = getRetryableOutboxItems(chatId);
  for (const item of retryable) {
    void sendOutboxItem(queryClient, item);
  }
}

export function resetInFlightForTests(): void {
  inFlightTempIds.clear();
}
