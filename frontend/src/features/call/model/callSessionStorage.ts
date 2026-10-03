import type { TCallKind, TCallRoomType } from './types';

export interface IStoredCallSession {
  roomId: string;
  peerId: string;
  peerName: string | null;
  peerAvatar: string | null;
  callKind: TCallKind;
  roomType: TCallRoomType;
  callStartedAt: number | null;
  isCaller: boolean;
  chatId: string | null;
  title: string | null;
  savedAt: number;
}

const STORAGE_KEY = 'crane_active_call_session';
export const MAX_SESSION_AGE_MS = 2 * 60 * 60 * 1000; // 2 часа

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCallSession(session: Omit<IStoredCallSession, 'savedAt'>): void {
  try {
    const storage = getSessionStorage();
    if (!storage) return;
    const data: IStoredCallSession = {
      ...session,
      savedAt: Date.now(),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Игнорируем ошибки квоты или недоступности sessionStorage
  }
}

export function loadCallSession(): IStoredCallSession | null {
  try {
    const storage = getSessionStorage();
    if (!storage) return null;
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as IStoredCallSession;
    if (!data || !data.roomId || !data.peerId || typeof data.savedAt !== 'number') {
      clearCallSession();
      return null;
    }
    // Если сессия сохранена слишком давно — сбрасываем
    if (Date.now() - data.savedAt > MAX_SESSION_AGE_MS) {
      clearCallSession();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearCallSession(): void {
  try {
    const storage = getSessionStorage();
    if (!storage) return;
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Игнорируем ошибки при очистке
  }
}
