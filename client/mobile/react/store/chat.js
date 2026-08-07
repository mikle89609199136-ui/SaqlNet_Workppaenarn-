import { create } from "zustand";
import services from "../services/serviceContainer";

const initialChatState = {
  chat: null,
  messages: [],
  error: "",
  editingMessage: null,
  draft: "",
  replyToMessage: null,
  selectedMessages: [],
  pinnedMessages: [],
  selectionMode: false,
  translations: {},
  actionMenu: null,
};

export const useChatStore = create((set, get) => {
  const withUpdater = (key) => (updater) =>
    set((state) => ({
      [key]: typeof updater === "function" ? updater(state[key]) : updater,
    }));

  return {
    ...initialChatState,
    setChat: (chat) => set({ chat }),
    setMessages: withUpdater("messages"),
    setError: (error) => set({ error }),
    setEditingMessage: (editingMessage) => set({ editingMessage }),
    setDraft: (draft) => set({ draft }),
    setReplyToMessage: (replyToMessage) => set({ replyToMessage }),
    setSelectedMessages: withUpdater("selectedMessages"),
    setPinnedMessages: withUpdater("pinnedMessages"),
    setSelectionMode: (selectionMode) => set({ selectionMode }),
    setTranslations: withUpdater("translations"),
    setActionMenu: (actionMenu) => set({ actionMenu }),
    resetChatState: () => set(initialChatState),
    updateChat: async (data) => {
      const chat = get().chat;
      await services.chatService.updateChat(chat.id, data);
      set((state) => ({ chat: { ...state.chat, ...data } }));
    },
  };
});
