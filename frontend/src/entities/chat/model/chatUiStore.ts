import type { IMessageDto, IReaction, TMessagesList } from '@/types';
import { create } from 'zustand';

export interface IActionMenu {
  messageId: string;
  x: number;
  y: number;
}

export interface IReactionAuthorsModalState {
  messageId: string;
  chatId?: string;
  initialEmoji?: string;
  reactions?: IReaction[];
}

type TTranslations = Record<string, string>;

/**
 * Состояние интерфейса открытого чата.
 *
 * Данные с сервера — сам чат, история и закреплённые — живут в кеше запросов
 * и сюда не попадают. Здесь только то, что рождается в интерфейсе и умирает
 * вместе с ним: выделение, открытые меню, показанные переводы.
 *
 * Недописанное сообщение живёт отдельно, в chatDraftsStore: у него свой
 * срок жизни (переживает уход в соседний чат) и своё требование — не
 * перерисовывать интерфейс на каждый набранный символ.
 *
 * Раньше те же сообщения лежали ещё и здесь, и во внутреннем кеше сервиса.
 * Синхронизировать три копии приходилось вручную в каждом обработчике,
 * и там, где об этом забывали, данные расходились.
 */
interface IChatState {
  error: string;
  editingMessage: IMessageDto | null;
  replyToMessage: IMessageDto | null;
  selectedMessages: TMessagesList;
  selectionMode: boolean;
  translations: TTranslations;
  actionMenu: IActionMenu | null;
  highlightedMessageId: string | null;
  /**
   * Перейти к сообщению из другой части экрана — например, из общего в
   * профиле (#842). Выполняет лента открытого чата и сбрасывает запрос.
   */
  jumpRequest: { chatId: string; messageId: string } | null;
  /**
   * Открыть профиль собеседника в чате — например, из истории звонков
   * (#1074). Выполняет страница этого чата и сбрасывает запрос.
   */
  profileRequest: { chatId: string; userId: string } | null;
  /** Что удалить — открытый диалог «Удалить сообщение?» (#840). */
  deleteTargets: TMessagesList | null;
  pinRequest: { targets: TMessagesList; unpin: boolean } | null;
  /** Просмотр списка авторов реакций (#998). */
  reactionAuthorsModal: IReactionAuthorsModalState | null;
}

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

interface IChatActions {
  setError: (error: string) => void;
  setEditingMessage: (message: IMessageDto | null) => void;
  setReplyToMessage: (message: IMessageDto | null) => void;
  setSelectedMessages: Updater<TMessagesList>;
  setSelectionMode: (mode: boolean) => void;
  setTranslations: Updater<TTranslations>;
  setActionMenu: (menu: IActionMenu | null) => void;
  setHighlightedMessageId: (id: string | null) => void;
  setJumpRequest: (request: { chatId: string; messageId: string } | null) => void;
  setProfileRequest: (request: { chatId: string; userId: string } | null) => void;
  setPinRequest: (request: IChatState['pinRequest']) => void;
  setDeleteTargets: (targets: TMessagesList | null) => void;
  setReactionAuthorsModal: (modal: IReactionAuthorsModalState | null) => void;
  resetChatState: (keepJumpForChatId?: string) => void;
}

const initialChatState: IChatState = {
  error: '',
  editingMessage: null,
  replyToMessage: null,
  selectedMessages: [],
  selectionMode: false,
  translations: {},
  actionMenu: null,
  highlightedMessageId: null,
  jumpRequest: null,
  profileRequest: null,
  deleteTargets: null,
  pinRequest: null,
  reactionAuthorsModal: null,
};

type InitialState = IChatState & IChatActions;

export const useChatUiStore = create<InitialState>((set) => {
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
    setReplyToMessage: (replyToMessage) => set({ replyToMessage }),
    setSelectedMessages: withUpdater('selectedMessages'),
    setSelectionMode: (selectionMode) => set({ selectionMode }),
    setTranslations: withUpdater('translations'),
    setActionMenu: (actionMenu) => set({ actionMenu }),
    setHighlightedMessageId: (highlightedMessageId) => set({ highlightedMessageId }),
    setJumpRequest: (jumpRequest) => set({ jumpRequest }),
    setProfileRequest: (profileRequest) => set({ profileRequest }),
    setPinRequest: (pinRequest) => set({ pinRequest }),
    setDeleteTargets: (deleteTargets) => set({ deleteTargets }),
    setReactionAuthorsModal: (reactionAuthorsModal) => set({ reactionAuthorsModal }),
    // Запрос перехода, адресованный новому чату, переживает смену чата: его
    // ставят перед переходом, а выполняет лента нового чата (#1076).
    resetChatState: (keepJumpForChatId) =>
      set((state) => ({
        ...initialChatState,
        jumpRequest:
          keepJumpForChatId && state.jumpRequest?.chatId === keepJumpForChatId
            ? state.jumpRequest
            : null,
      })),
  };
});
