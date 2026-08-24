import { services } from '@/services';
import type { TChatsList } from '@/types';
import { create } from 'zustand';

interface IChatsState {
  chats: TChatsList;
}

interface IChatsActions {
  setChats: (chats: TChatsList | ((prev: TChatsList) => TChatsList)) => void;
  deleteChat: (chatId: string) => Promise<IDeleteChatResponse>;
}

type InitialState = IChatsState & IChatsActions;

interface IDeleteChatResponse {
  success: boolean;
}

export const useChatsStore = create<InitialState>((set, get) => {
  const withUpdater =
    <K extends keyof IChatsState>(key: K) =>
    (updater: IChatsState[K] | ((prev: IChatsState[K]) => IChatsState[K])) =>
      set(
        (state) =>
          ({
            [key]:
              typeof updater === 'function'
                ? (updater as (prev: IChatsState[K]) => IChatsState[K])(state[key])
                : updater,
          }) as Pick<IChatsState, K>
      );

  return {
    chats: [],
    setChats: withUpdater('chats'),
    deleteChat: async (chatId) => {
      const result = await services.chatService.deleteChat<IDeleteChatResponse>(chatId);

      if (result.success) {
        const chats = get().chats;
        const updatedChatsList = chats.filter((chat) => chat.id !== chatId);

        set({ chats: updatedChatsList });
      }

      return result;
    },
  };
});
