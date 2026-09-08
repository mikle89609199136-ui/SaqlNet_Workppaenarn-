import type { QueryClient } from '@tanstack/react-query';
import { services } from '@/services';
import type { TMediaMessageType } from '@/types';
import { chatKeys } from '../keys';
import type { IThreadPages } from './threadCache';
import {
  dropThreadMessage,
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

/**
 * Проверяет, не появилось ли уже такое сообщение в кеше треда (пришло по WebSocket
 * или предыдущий запрос завершился успехом на бэкенде, но ответ потерялся).
 */
function findExistingConfirmedMessage(
  queryClient: QueryClient,
  chatId: string,
  item: IOutboxItem
): boolean {
  const data = queryClient.getQueryData<IThreadPages>(chatKeys.messages(chatId));
  if (!data?.pages) return false;

  const itemTime = item.createdAt ? new Date(item.createdAt).getTime() : 0;

  for (const page of data.pages) {
    for (const msg of page) {
      if (msg.id === item.tempId || msg.tempId === item.tempId) continue;
      if (
        msg.id.startsWith('temp-') ||
        Boolean(msg.tempId) ||
        msg.status === 'failed' ||
        msg.status === 'pending' ||
        msg.status === 'uploading'
      ) {
        continue;
      }
      if (msg.content === item.content && msg.type === item.type) {
        const msgTime = new Date(msg.createdAt).getTime();
        if (Math.abs(msgTime - itemTime) < 60_000) {
          return true;
        }
      }
    }
  }
  return false;
}

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
    if (findExistingConfirmedMessage(queryClient, item.chatId, item)) {
      dropThreadMessage(queryClient, item.chatId, item.tempId);
      removeOutboxItem(item.tempId);
      callbacks?.onSuccess?.();
      return;
    }

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
    if (findExistingConfirmedMessage(queryClient, item.chatId, item)) {
      dropThreadMessage(queryClient, item.chatId, item.tempId);
      removeOutboxItem(item.tempId);
      callbacks?.onSuccess?.();
      return;
    }

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
  });
  updateOutboxItem(item.tempId, {
    status: item.file ? 'uploading' : 'pending',
    error: undefined,
  });

  await sendOutboxItem(queryClient, item, callbacks);
}

/**
 * Автоматический перезапуск отправки всех зависших/ошибочных сообщений
 * последовательно для сохранения порядка сообщений.
 */
export async function retryAllOutboxMessages(
  queryClient: QueryClient,
  chatId?: string
): Promise<void> {
  const retryable = getRetryableOutboxItems(chatId);
  for (const item of retryable) {
    patchThreadMessage(queryClient, item.chatId, item.tempId, {
      status: item.file ? 'uploading' : 'pending',
    });
    updateOutboxItem(item.tempId, {
      status: item.file ? 'uploading' : 'pending',
      error: undefined,
    });
    await sendOutboxItem(queryClient, item);
  }
}

export function resetInFlightForTests(): void {
  inFlightTempIds.clear();
}
