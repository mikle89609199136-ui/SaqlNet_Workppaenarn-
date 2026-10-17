import type { QueryClient } from '@tanstack/react-query';
import { services } from '@/services';
import type { TMediaMessageType } from '@/types';
import { encodeChatPhoto } from '@/shared/lib';
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

      /* Фото — пересжать до шифрования: после него сервер видит только
         шифровку и уменьшить ничего не может. Готовый файл — обратно в
         очередь, чтобы повтор после сбоя не сжимал заново. */
      let file = item.file;
      if (item.optimizeImage && file instanceof File) {
        file = await encodeChatPhoto(file);
        updateOutboxItem(item.tempId, { file, optimizeImage: false });
      }

      const message = await services.messageService.sendMediaMessage(
        item.chatId,
        file,
        item.type as TMediaMessageType,
        item.content,
        item.replyToId ?? null,
        item.entities ?? [],
        item.voice
      );

      /* `sent` — это «сервер принял», и ничего больше: ответ на отправку и
         есть подтверждение. Прочтения тут быть не может — сервер не
         отдаёт, до какого сообщения прочитал собеседник. */
      replaceThreadMessage(queryClient, item.chatId, item.tempId, { ...message, status: 'sent' });
      removeOutboxItem(item.tempId);
    } else if (item.type === 'sticker') {
      patchThreadMessage(queryClient, item.chatId, item.tempId, {
        status: 'pending',
      });

      const message = await services.messageService.sendSticker(
        item.chatId,
        item.mediaUrl ?? item.content,
        item.replyToId ?? null
      );

      replaceThreadMessage(queryClient, item.chatId, item.tempId, { ...message, status: 'sent' });
      removeOutboxItem(item.tempId);
    } else if (item.type === 'gif') {
      patchThreadMessage(queryClient, item.chatId, item.tempId, {
        status: 'pending',
      });

      const message = await services.messageService.sendGif(
        item.chatId,
        item.mediaUrl ?? item.content,
        item.replyToId ?? null
      );

      replaceThreadMessage(queryClient, item.chatId, item.tempId, { ...message, status: 'sent' });
      removeOutboxItem(item.tempId);
    } else {
      patchThreadMessage(queryClient, item.chatId, item.tempId, {
        status: 'pending',
      });

      const message = await services.messageService.sendMessage(
        item.chatId,
        item.content,
        'text',
        item.replyToId ?? null,
        item.entities ?? []
      );

      replaceThreadMessage(queryClient, item.chatId, item.tempId, { ...message, status: 'sent' });
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
/** Последний назначенный проход по очереди: следующий ждёт его. */
let retryChain: Promise<void> = Promise.resolve();

/**
 * Повторить очередь — после переподключения, возврата сети и вкладки.
 *
 * Проходы идут строго один за другим (#1069). Два одновременных друг о
 * друге не знали: второй пропускал сообщение, которое ещё отправлял
 * первый, и отправлял следующее раньше него — у собеседника порядок
 * нарушался. Вызов во время прохода ждёт его и делает свой.
 */
export function retryAllOutboxMessages(queryClient: QueryClient, chatId?: string): Promise<void> {
  const pass = retryChain.then(() => retryOutboxPass(queryClient, chatId));
  retryChain = pass.catch(() => {});
  return pass;
}

async function retryOutboxPass(queryClient: QueryClient, chatId?: string): Promise<void> {
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
