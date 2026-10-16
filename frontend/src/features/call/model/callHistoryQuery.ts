import { infiniteQueryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import type {
  ICallHistoryItemDto,
  ICallHistoryParams,
  ICallHistoryResponse,
} from '@/services/types/callApi.types';
import { callKeys } from './callKeys';

export function callHistoryInfiniteQuery(params: Omit<ICallHistoryParams, 'cursor'> = {}) {
  return infiniteQueryOptions<
    ICallHistoryResponse,
    Error,
    ICallHistoryResponse,
    ReturnType<typeof callKeys.history>,
    string
  >({
    queryKey: callKeys.history(params),
    queryFn: async ({ pageParam }) => {
      try {
        return await services.callService.getCallHistory({
          ...params,
          cursor: pageParam || undefined,
        });
      } catch (error) {
        // Если бэкенд ещё не реализован (404), возвращаем пустой список,
        // чтобы экран сразу показывал empty state (#722)
        const isNotFound = (error as { status?: number })?.status === 404;
        if (isNotFound) {
          return { calls: [], nextCursor: null, hasMore: false };
        }
        throw error;
      }
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    staleTime: 60 * 1000,
  });
}

/** Дедуплицирует звонки по id или roomId из всех страниц пагинации */
export function flattenCallHistory(
  data: { pages?: ICallHistoryResponse[] } | ICallHistoryResponse[] | undefined
): ICallHistoryItemDto[] {
  if (!data) return [];
  const pages = Array.isArray(data) ? data : data.pages;
  if (!pages || pages.length === 0) return [];
  const seen = new Set<string>();
  const result: ICallHistoryItemDto[] = [];

  for (const page of pages) {
    if (!page?.calls) continue;
    for (const call of page.calls) {
      const key = call.id || call.roomId;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(call);
      }
    }
  }

  return result;
}
