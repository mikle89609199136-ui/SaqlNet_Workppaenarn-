import { create } from 'zustand';

/** Сколько показывать «печатает», если следующего события так и не пришло. */
const TYPING_TIMEOUT_MS = 3000;

export interface ITypingUser {
  userId: string;
  /** Имя из события — если сервер его прислал (#866). */
  firstName?: string;
}

interface ITypingState {
  /**
   * Кто печатает в каждом чате — в порядке, в каком начали (#837). Чата
   * без печатающих в словаре нет вовсе: строки списка подписаны каждая на
   * свой чат, и массив чужого чата при изменении не пересоздаётся.
   */
  typingByChat: Record<string, ITypingUser[]>;
  setTyping: (chatId: string, userId: string, firstName?: string) => void;
  /** Без `userId` — снять всех печатающих в чате. */
  clearTyping: (chatId: string, userId?: string) => void;
}

const timerKey = (chatId: string, userId: string) => `${chatId}:${userId}`;

/**
 * Индикатор набора текста.
 *
 * Не данные: живёт три секунды, не кешируется и не перезапрашивается.
 * В группе печатают несколько человек сразу, поэтому таймер у каждого
 * свой: один замолчал — пропадает только он.
 */
export const useTypingStore = create<ITypingState>((set, get) => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const stopTimer = (key: string) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
  };

  return {
    typingByChat: {},

    setTyping: (chatId, userId, firstName) => {
      const key = timerKey(chatId, userId);
      stopTimer(key);
      timers.set(
        key,
        setTimeout(() => get().clearTyping(chatId, userId), TYPING_TIMEOUT_MS)
      );

      set((state) => {
        const current = state.typingByChat[chatId] ?? [];
        const existing = current.find((item) => item.userId === userId);
        // Тот же человек с тем же именем — продлили таймер, и только:
        // новый массив заставил бы перерисоваться строку списка.
        if (existing && (!firstName || existing.firstName === firstName)) return state;

        const next = existing
          ? current.map((item) => (item.userId === userId ? { ...item, firstName } : item))
          : [...current, { userId, firstName }];
        return { typingByChat: { ...state.typingByChat, [chatId]: next } };
      });
    },

    clearTyping: (chatId, userId) => {
      const current = get().typingByChat[chatId];
      if (!current) return;

      const leaving = userId ? current.filter((item) => item.userId === userId) : current;
      if (leaving.length === 0) return;
      leaving.forEach((item) => stopTimer(timerKey(chatId, item.userId)));

      set((state) => {
        const rest = userId ? current.filter((item) => item.userId !== userId) : [];
        const next = { ...state.typingByChat };
        if (rest.length > 0) next[chatId] = rest;
        else delete next[chatId];
        return { typingByChat: next };
      });
    },
  };
});
