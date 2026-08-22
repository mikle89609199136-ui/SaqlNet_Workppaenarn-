import { services } from '@/services';
import type { IChatDto, IMessageDto, IPinnedDto, IPinnedMessageDto, TMessagesList } from '@/types';
import { create } from 'zustand';

export interface IActionMenu {
  messageId: string;
  x: number;
  y: number;
}

type TTranslations = Record<string, string>;

interface IChatState {
  chat: IChatDto | null;
  messages: TMessagesList;
  error: string;
  editingMessage: IMessageDto | null;
  draft: string;
  replyToMessage: IMessageDto | null;
  selectedMessages: TMessagesList;
  pinnedMessages: IPinnedDto[];
  selectionMode: boolean;
  translations: TTranslations;
  actionMenu: IActionMenu | null;
}

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

interface IChatActions {
  setChat: (chat: IChatDto | null) => void;
  setMessages: Updater<TMessagesList>;
  setError: (error: string) => void;
  setEditingMessage: (message: IMessageDto | null) => void;
  setDraft: (draft: string) => void;
  setReplyToMessage: (message: IMessageDto | null) => void;
  setSelectedMessages: Updater<TMessagesList>;
  setPinnedMessages: Updater<IPinnedDto[]>;
  setSelectionMode: (mode: boolean) => void;
  setTranslations: Updater<TTranslations>;
  setActionMenu: (menu: IActionMenu | null) => void;
  resetChatState: () => void;
  updateChat: (data: Partial<IChatDto>) => Promise<void>;
  markAsRead: (messageId: string) => void;
  updateMessage: (messageId: string, patch: Partial<Omit<IMessageDto, 'id'>>) => void;
  updatePinnedMessage: (messageId: string, patch: Partial<Omit<IPinnedMessageDto, 'id'>>) => void;
}

const initialChatState: IChatState = {
  chat: null,
  messages: [],
  error: '',
  editingMessage: null,
  draft: '',
  replyToMessage: null,
  selectedMessages: [],
  pinnedMessages: [],
  selectionMode: false,
  translations: {},
  actionMenu: null,
};

type InitialState = IChatState & IChatActions;

export const useChatStore = create<InitialState>((set, get) => {
  const withUpdater =
    <K extends keyof IChatState>(key: K) =>
    (updater: IChatState[K] | ((prev: IChatState[K]) => IChatState[K])) =>
      set(
        (state) =>
          ({
            [key]:
              typeof updater === 'function'
                ? (updater as (prev: IChatState[K]) => IChatState[K])(state[key])
                : updater,
          }) as Pick<IChatState, K>
      );

  return {
    ...initialChatState,
    setChat: (chat) => set({ chat }),
    setMessages: withUpdater('messages'),
    setError: (error) => set({ error }),
    setEditingMessage: (editingMessage) => set({ editingMessage }),
    setDraft: (draft) => set({ draft }),
    setReplyToMessage: (replyToMessage) => set({ replyToMessage }),
    setSelectedMessages: withUpdater('selectedMessages'),
    setPinnedMessages: withUpdater('pinnedMessages'),
    setSelectionMode: (selectionMode) => set({ selectionMode }),
    setTranslations: withUpdater('translations'),
    setActionMenu: (actionMenu) => set({ actionMenu }),
    resetChatState: () => set(initialChatState),
    updateChat: async (data) => {
      const chat = get().chat;
      if (!chat) return;
      await services.chatService.updateChat(chat.id, data);
      set({ chat: { ...chat, ...data } });
    },
    markAsRead: (messageId: string) => {
      const messages = get().messages;
      const messageIndex = messages.findIndex((message) => message.id === messageId);

      if (!messageIndex) return;

      const message = messages[messageIndex];
      const readMessage = {
        ...message,
        isRead: true,
        status: 'read',
      };

      messages[messageIndex] = readMessage;

      set({ messages });
    },
    updateMessage: (messageId: string, patch: Partial<Omit<IMessageDto, 'id'>>) => {
      const messages = get().messages;
      const updatedMessages = messages.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message
      );
      set({ messages: updatedMessages });
    },
    updatePinnedMessage: (messageId: string, patch: Partial<Omit<IPinnedMessageDto, 'id'>>) => {
      const pinnedMessages = get().pinnedMessages;
      const updatedPinnedMessages = pinnedMessages.map((item) =>
        item.id === messageId
          ? {
              ...item,
              message: {
                ...item.message,
                ...patch,
              },
            }
          : item
      );
      set({ pinnedMessages: updatedPinnedMessages });
    },
  };
});
