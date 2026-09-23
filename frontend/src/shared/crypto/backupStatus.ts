/**
 * Состояние резервной копии ключей на этом устройстве.
 *
 * - `checking` — ещё не выяснили;
 * - `ready` — ключи на месте, копия есть, переписка работает;
 * - `locked` — копия есть, но это устройство её ещё не открыло: нужен
 *   облачный пароль, passkey или вход по QR;
 * - `needsSetup` — копии нет: нужно задать облачный пароль. `migrating` —
 *   на устройстве уже есть переписка прежней схемы, она уйдёт в копию;
 * - `unavailable` — шифрование в этом окружении невозможно (нет WebCrypto).
 *
 * Хранилище вне React: на него подписан только экран-заслонка, приход
 * сообщений его не трогает.
 */

export type TBackupStatus = 'checking' | 'ready' | 'locked' | 'needsSetup' | 'unavailable';

export interface IBackupState {
  status: TBackupStatus;
  /** Копию можно открыть passkey: в ней есть такой слот. */
  hasPasskey: boolean;
  /** На устройстве есть переписка прежней схемы — при настройке она уйдёт в копию. */
  migrating: boolean;
}

const INITIAL_STATE: IBackupState = { status: 'checking', hasPasskey: false, migrating: false };

let state: IBackupState = INITIAL_STATE;
const listeners = new Set<() => void>();

export function readBackupState(): IBackupState {
  return state;
}

export function setBackupState(next: IBackupState): void {
  if (
    next.status === state.status &&
    next.hasPasskey === state.hasPasskey &&
    next.migrating === state.migrating
  ) {
    return;
  }

  state = next;
  for (const listener of listeners) listener();
}

export function subscribeToBackupState(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Выход из аккаунта: следующему не должно достаться состояние прежнего. */
export function forgetBackupState(): void {
  setBackupState(INITIAL_STATE);
}
