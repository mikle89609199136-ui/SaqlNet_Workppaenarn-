import { create } from 'zustand';
import type { IMessageDto } from '@/types';

/** partial — дошли до предела страниц, failed — история не дочиталась. */
export type THistoryStatus = 'loading' | 'complete' | 'partial' | 'failed';

interface IMessageSearchState {
  chatId: string | null;
  query: string;
  searchedQuery: string;
  results: IMessageDto[];
  currentIndex: number;
  historyStatus: THistoryStatus;
  scannedCount: number;
}

interface IMessageSearchStore extends IMessageSearchState {
  open: (chatId: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  setResults: (
    searchedQuery: string,
    results: IMessageDto[],
    historyStatus: THistoryStatus,
    scannedCount: number
  ) => void;
  select: (index: number) => void;
  older: () => void;
  newer: () => void;
}

const CLOSED: IMessageSearchState = {
  chatId: null,
  query: '',
  searchedQuery: '',
  results: [],
  currentIndex: 0,
  historyStatus: 'complete',
  scannedCount: 0,
};

const clampIndex = (index: number, length: number) => Math.min(Math.max(index, 0), length - 1);

export const useMessageSearchStore = create<IMessageSearchStore>((set) => ({
  ...CLOSED,
  open: (chatId) => set({ ...CLOSED, chatId }),
  close: () => set(CLOSED),
  setQuery: (query) => set({ query, results: [], currentIndex: 0 }),
  setResults: (searchedQuery, results, historyStatus, scannedCount) =>
    set((state) => {
      const currentId = state.results[state.currentIndex]?.id;
      const kept = results.findIndex((message) => message.id === currentId);
      return {
        searchedQuery,
        results,
        historyStatus,
        scannedCount,
        currentIndex: kept === -1 ? 0 : kept,
      };
    }),
  select: (index) =>
    set((state) =>
      state.results.length ? { currentIndex: clampIndex(index, state.results.length) } : {}
    ),
  older: () =>
    set((state) =>
      state.results.length
        ? { currentIndex: clampIndex(state.currentIndex + 1, state.results.length) }
        : {}
    ),
  newer: () =>
    set((state) =>
      state.results.length
        ? { currentIndex: clampIndex(state.currentIndex - 1, state.results.length) }
        : {}
    ),
}));

export const selectCurrentMatch = (state: IMessageSearchState) =>
  state.results[state.currentIndex] ?? null;
