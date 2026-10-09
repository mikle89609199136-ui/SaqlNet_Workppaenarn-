import type { ICallHistoryParams } from '@/services/types/callApi.types';

export const callKeys = {
  all: ['calls'] as const,
  history: (params?: ICallHistoryParams) => ['calls', 'history', params ?? {}] as const,
  historyAll: () => ['calls', 'history'] as const,
};
