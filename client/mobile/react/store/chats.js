import { create } from "zustand";
import services from "../services/serviceContainer";

export const useChatsStore = create((set, get) => ({
  chats: [],
  setChats: (chats) =>
    set((state) => ({
      chats: typeof chats === "function" ? chats(state.chats) : chats,
    })),
  deleteChat: async (chatId) => {
    const result = await services.chatService.deleteChat(chatId);

    if (result.success) {
      const chats = get().chats;
      const updatedChatsList = chats.filter((chat) => chat.id !== chatId);

      set({ chats: updatedChatsList });
    }

    return result;
  }
}));
