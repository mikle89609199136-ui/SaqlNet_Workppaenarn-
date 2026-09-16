import { create } from 'zustand';

/** Сколько показывать «печатает», если следующего события так и не пришло. */
const TYPING_TIMEOUT_MS = 3000;

interface ITypingState {
  /** Кто печатает в каждом чате: идентификатор пользователя. */
  typingByChat: Record<string, string>;
  setTyping: (chatId: string, userId: string) => void;
  clearTyping: (chatId: string) => void;
}

/**
 * Индикатор набора текста.
 *
 * Не данные: живёт три секунды, не кешируется и не перезапрашивается.
 * Раньше это же состояние поддерживали два независимых таймера — один
 * для списка чатов, другой для открытого треда.
 */
export const useTypingStore = create<ITypingState>((set, get) => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    typingByChat: {},

    setTyping: (chatId, userId) => {
      clearTimeout(timers.get(chatId));

      set((state) => ({ typingByChat: { ...state.typingByChat, [chatId]: userId } }));

      timers.set(
        chatId,
        setTimeout(() => get().clearTyping(chatId), TYPING_TIMEOUT_MS)
      );
    },

    clearTyping: (chatId) => {
      clearTimeout(timers.get(chatId));
      timers.delete(chatId);

      set((state) => {
        if (!state.typingByChat[chatId]) return state;

        const next = { ...state.typingByChat };
        delete next[chatId];
        return { typingByChat: next };
      });
    },
  };
});
