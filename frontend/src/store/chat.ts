import type { IMessageDto, TMessagesList } from '@/types';
import { create } from 'zustand';

export interface IActionMenu {
  messageId: string;
  x: number;
  y: number;
}

type TTranslations = Record<string, string>;

/**
 * Состояние интерфейса открытого чата.
 *
 * Данные с сервера — сам чат, история и закреплённые — живут в кеше запросов
 * и сюда не попадают. Здесь только то, что рождается в интерфейсе и умирает
 * вместе с ним: черновик, выделение, открытые меню, показанные переводы.
 *
 * Раньше те же сообщения лежали ещё и здесь, и во внутреннем кеше сервиса.
 * Синхронизировать три копии приходилось вручную в каждом обработчике,
 * и там, где об этом забывали, данные расходились.
 */
interface IChatState {
  error: string;
  editingMessage: IMessageDto | null;
  draft: string;
  replyToMessage: IMessageDto | null;
  selectedMessages: TMessagesList;
  selectionMode: boolean;
  translations: TTranslations;
  actionMenu: IActionMenu | null;
}

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

interface IChatActions {
  setError: (error: string) => void;
  setEditingMessage: (message: IMessageDto | null) => void;
  setDraft: (draft: string) => void;
  setReplyToMessage: (message: IMessageDto | null) => void;
  setSelectedMessages: Updater<TMessagesList>;
  setSelectionMode: (mode: boolean) => void;
  setTranslations: Updater<TTranslations>;
  setActionMenu: (menu: IActionMenu | null) => void;
  resetChatState: () => void;
}

const initialChatState: IChatState = {
  error: '',
  editingMessage: null,
  draft: '',
  replyToMessage: null,
  selectedMessages: [],
  selectionMode: false,
  translations: {},
  actionMenu: null,
};

type InitialState = IChatState & IChatActions;

export const useChatStore = create<InitialState>((set) => {
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
    setError: (error) => set({ error }),
    setEditingMessage: (editingMessage) => set({ editingMessage }),
    setDraft: (draft) => set({ draft }),
    setReplyToMessage: (replyToMessage) => set({ replyToMessage }),
    setSelectedMessages: withUpdater('selectedMessages'),
    setSelectionMode: (selectionMode) => set({ selectionMode }),
    setTranslations: withUpdater('translations'),
    setActionMenu: (actionMenu) => set({ actionMenu }),
    resetChatState: () => set(initialChatState),
  };
});
