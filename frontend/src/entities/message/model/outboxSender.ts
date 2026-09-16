import type { QueryClient } from '@tanstack/react-query';
import { services } from '@/services';
import type { TMediaMessageType } from '@/types';
import { dropThreadMessage, patchThreadMessage, replaceThreadMessage } from './threadCacheActions';
import {
  type IOutboxItem,
  removeOutboxItem,
  updateOutboxItem,
  getOutboxItem,
  getRetryableOutboxItems,
} from './outboxStore';

/** Map временных ID в timestamp запуска отправки, с TTL для защиты от зависших вызовов */
const inFlightTempIds = new Map<string, number>();
const IN_FLIGHT_TIMEOUT_MS = 30_000;

function isInFlight(tempId: string): boolean {
  const startedAt = inFlightTempIds.get(tempId);
  if (!startedAt) return false;
  if (Date.now() - startedAt > IN_FLIGHT_TIMEOUT_MS) {
    inFlightTempIds.delete(tempId);
    return false;
  }
  return true;
}

export const MAX_AUTO_RETRIES = 3;
export const BASE_RETRY_DELAY_MS = 1000;

export interface ISendOutboxCallbacks {
  onError?: (err: unknown) => void;
  onSuccess?: () => void;
}

/**
 * Отправка сообщения из Outbox.
 *
 * Если сообщение с медиа-вложением — переводит статус в uploading
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
  if (isInFlight(item.tempId)) return;
  inFlightTempIds.set(item.tempId, Date.now());

  try {
    if (item.file) {
      patchThreadMessage(queryClient, item.chatId, item.tempId, {
        status: 'uploading',
      });

      const message = await services.messageService.sendMediaMessage(
        item.chatId,
        item.file,
        item.type as TMediaMessageType,
        item.content,
        item.replyToId ?? null
      );

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
    const nextRetryCount = (item.retryCount ?? 0) + 1;
    patchThreadMessage(queryClient, item.chatId, item.tempId, {
      status: 'failed',
    });
    updateOutboxItem(item.tempId, {
      status: 'failed',
      retryCount: nextRetryCount,
      lastAttemptAt: Date.now(),
      error: err instanceof Error ? err.message : 'Send failed',
    });
    callbacks?.onError?.(err);
  } finally {
    inFlightTempIds.delete(item.tempId);
  }
}

/**
 * Повторная отправка сообщения из очереди Outbox по клику на кнопку Retry.
 * Сбрасывает счетчик попыток для ручного перезапуска.
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
  });
  updateOutboxItem(item.tempId, {
    status: item.file ? 'uploading' : 'pending',
    retryCount: 0,
    lastAttemptAt: undefined,
    error: undefined,
  });

  const updatedItem = getOutboxItem(targetId) ?? item;
  await sendOutboxItem(queryClient, updatedItem, callbacks);
}

/**
 * Автоматический перезапуск отправки всех зависших/ошибочных сообщений
 * последовательно для сохранения порядка сообщений с учетом лимита попыток
 * и экспоненциальной задержки.
 */
export async function retryAllOutboxMessages(
  queryClient: QueryClient,
  chatId?: string
): Promise<void> {
  const retryable = getRetryableOutboxItems(chatId);
  for (const item of retryable) {
    if ((item.retryCount ?? 0) >= MAX_AUTO_RETRIES) {
      continue;
    }

    if (item.lastAttemptAt && item.retryCount) {
      const backoffMs = Math.min(BASE_RETRY_DELAY_MS * 2 ** (item.retryCount - 1), 30_000);
      if (Date.now() - item.lastAttemptAt < backoffMs) {
        continue;
      }
    }

    patchThreadMessage(queryClient, item.chatId, item.tempId, {
      status: item.file ? 'uploading' : 'pending',
    });
    updateOutboxItem(item.tempId, {
      status: item.file ? 'uploading' : 'pending',
      error: undefined,
    });
    const updatedItem = getOutboxItem(item.tempId) ?? item;
    await sendOutboxItem(queryClient, updatedItem);
  }
}

/**
 * Отмена и удаление сообщения из очереди Outbox и кеша треда.
 * Освобождает ресурсы вложений (отзыв Blob URL, освобождение File).
 */
export function cancelOutboxMessage(
  queryClient: QueryClient,
  chatId: string,
  tempId: string
): void {
  removeOutboxItem(tempId);
  dropThreadMessage(queryClient, chatId, tempId);
}

export function resetInFlightForTests(): void {
  inFlightTempIds.clear();
}
