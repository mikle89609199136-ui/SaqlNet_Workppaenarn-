import { create } from 'zustand';
import type { IMessageDto } from '@/types';

/** Пересылка, которая ждёт отправки в целевом чате. */
export interface IPendingForward {
  targetChatId: string;
  /** В хронологическом порядке — так их и увидит получатель. */
  messages: IMessageDto[];
}

interface IForwardStore {
  pending: IPendingForward | null;
  /** Выбран чат: пересылка ждёт в нём, пока человек не нажмёт «Отправить». */
  start: (targetChatId: string, messages: IMessageDto[]) => void;
  /** Часть ушла: в плашке остаются только неотправленные. */
  keep: (messages: IMessageDto[]) => void;
  cancel: () => void;
}

function createdAtOf(message: IMessageDto): number {
  return new Date(message.createdAt).getTime() || 0;
}

/**
 * Отложенная пересылка (#93).
 *
 * Живёт отдельно от `chatUiStore`: тот сбрасывается при переходе в другой
 * чат, а пересылка как раз и переходит — из чата, где сообщения выбрали, в
 * тот, куда их отправят. Только в памяти: после перезагрузки выбирать
 * заново, как и выделение.
 */
export const useForwardStore = create<IForwardStore>((set) => ({
  pending: null,
  start: (targetChatId, messages) =>
    set({
      pending: {
        targetChatId,
        // Выделяют в любом порядке, а читать пересланное надо так, как
        // его писали.
        messages: [...messages].sort((a, b) => createdAtOf(a) - createdAtOf(b)),
      },
    }),
  keep: (messages) =>
    set((state) =>
      state.pending && messages.length > 0
        ? { pending: { ...state.pending, messages } }
        : { pending: null }
    ),
  cancel: () => set({ pending: null }),
}));
