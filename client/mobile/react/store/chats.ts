import { create } from "zustand";

export const useChatsStore = create((set) => ({
	chats: [],
  setChats: (chats: any) =>
    set((state: { chats: any; }) => ({
      chats: typeof chats === 'function'
        ? chats(state.chats)
        : chats,
    })),
}));