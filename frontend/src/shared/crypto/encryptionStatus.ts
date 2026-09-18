/**
 * Готовность шифрования в открытом чате.
 *
 * Ключ чата может быть ещё не создан, а кто-то из участников — ещё не
 * входить с новой версией приложения. И то и другое человеку важно знать
 * до того, как он нажмёт «отправить», а не после.
 *
 * Хранилище намеренно вне React: подписан на него только композер, и
 * приход сообщений или набор текста его не трогают.
 */

export type TEncryptionStatus = 'preparing' | 'ready' | 'unavailable';

export interface IEncryptionState {
  status: TEncryptionStatus;
  /** Участники, для которых ключ завернуть не удалось. */
  unreachable: string[];
}

const EMPTY_STATE: IEncryptionState = { status: 'preparing', unreachable: [] };

const states = new Map<string, IEncryptionState>();
const listeners = new Set<() => void>();

export function readEncryptionState(chatId: string): IEncryptionState {
  return states.get(chatId) ?? EMPTY_STATE;
}

export function setEncryptionState(chatId: string, next: IEncryptionState): void {
  const previous = states.get(chatId);

  if (
    previous?.status === next.status &&
    previous.unreachable.length === next.unreachable.length &&
    previous.unreachable.every((id, index) => id === next.unreachable[index])
  ) {
    return;
  }

  states.set(chatId, next);
  for (const listener of listeners) listener();
}

export function subscribeToEncryptionState(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Выход из аккаунта: состояние следующего не должно достаться от прежнего. */
export function forgetEncryptionStates(): void {
  states.clear();
  for (const listener of listeners) listener();
}
