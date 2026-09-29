import {
  readEncryptionState,
  setEncryptionState,
  subscribeToEncryptionState,
  type IEncryptionState,
} from '@/shared/crypto';
import { services } from '@/services/serviceContainer';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * Подготовка шифрования открытого чата.
 *
 * При входе в чат ключ либо уже есть на устройстве, либо забирается с
 * сервера, либо создаётся — и тогда же доворачивается тем участникам, у
 * кого его нет: человек мог войти с нового устройства или появиться в
 * чате, пока нас не было.
 *
 * Первое действие обязательно, второе — по возможности: не удалось
 * долечить, значит кто-то из собеседников пока не прочтёт написанное, но
 * сама переписка от этого не останавливается.
 */
/*
 * Повторная попытка (#826): «Проверить» на плашке «Шифрование недоступно».
 * Номер попытки — зависимость эффекта ниже: сменился — подготовка идёт
 * заново. Хранится вне React, как и само состояние шифрования.
 */
const attempts = new Map<string, number>();
const attemptListeners = new Set<() => void>();

function subscribeToAttempts(listener: () => void): () => void {
  attemptListeners.add(listener);
  return () => {
    attemptListeners.delete(listener);
  };
}

/** Подготовить шифрование чата заново: ключ мог появиться за это время. */
export function retryChatEncryption(chatId: string): void {
  attempts.set(chatId, (attempts.get(chatId) ?? 0) + 1);
  setEncryptionState(chatId, { status: 'preparing', unreachable: [] });
  for (const listener of attemptListeners) listener();
}

export function useChatEncryption(chatId: string): void {
  const attempt = useSyncExternalStore(
    subscribeToAttempts,
    () => attempts.get(chatId) ?? 0,
    () => 0
  );

  useEffect(() => {
    if (!chatId) return undefined;

    let cancelled = false;

    const prepare = async () => {
      try {
        const { chatKey, membersWithoutIdentity } =
          await services.cryptoService.ensureChatKey(chatId);

        if (cancelled) return;

        setEncryptionState(chatId, {
          status: chatKey ? 'ready' : 'unavailable',
          unreachable: membersWithoutIdentity,
        });

        if (!chatKey) return;

        const healed = await services.cryptoService.healChatKeys(chatId);
        if (cancelled) return;

        setEncryptionState(chatId, {
          status: 'ready',
          unreachable: healed.membersWithoutIdentity,
        });
      } catch (error) {
        if (cancelled) return;

        console.warn('Не удалось подготовить шифрование чата', error);
        setEncryptionState(chatId, { status: 'unavailable', unreachable: [] });
      }
    };

    void prepare();

    return () => {
      cancelled = true;
    };
  }, [chatId, attempt]);
}

/** Состояние шифрования чата. Перерисовывается только тот, кто его читает. */
export function useEncryptionState(chatId: string): IEncryptionState {
  return useSyncExternalStore(
    subscribeToEncryptionState,
    () => readEncryptionState(chatId),
    () => readEncryptionState(chatId)
  );
}
