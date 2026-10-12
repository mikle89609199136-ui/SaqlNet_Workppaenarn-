import { describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { callHistoryInfiniteQuery, flattenCallHistory } from './callHistoryQuery';
import type { ICallHistoryResponse } from '@/services/types/callApi.types';

describe('callHistoryQuery', () => {
  it('запрашивает историю звонков с переданным pageParam', async () => {
    const mockGetHistory = vi.spyOn(services.callService, 'getCallHistory').mockResolvedValueOnce({
      calls: [
        {
          id: 'call-1',
          roomId: 'room-1',
          peerId: 'peer-1',
          direction: 'incoming',
          kind: 'audio',
          status: 'answered',
          startedAt: '2026-10-09T10:00:00Z',
          durationSeconds: 60,
        },
      ],
      nextCursor: 'next-123',
      hasMore: true,
    });

    const options = callHistoryInfiniteQuery({ kind: 'audio' });
    const result = await options.queryFn({ pageParam: 'cursor-abc' } as any);

    expect(mockGetHistory).toHaveBeenCalledWith({
      kind: 'audio',
      cursor: 'cursor-abc',
    });
    expect(result.calls).toHaveLength(1);
    expect(result.nextCursor).toBe('next-123');
  });

  it('возвращает пустой результат при ошибке 404 (бэкенд ещё не готов)', async () => {
    const notFoundError = new Error('Not found') as Error & { status: number };
    notFoundError.status = 404;
    vi.spyOn(services.callService, 'getCallHistory').mockRejectedValueOnce(notFoundError);

    const options = callHistoryInfiniteQuery();
    const result = await options.queryFn({ pageParam: '' } as any);

    expect(result).toEqual({ calls: [], nextCursor: null, hasMore: false });
  });

  it('пробрасывает другие ошибки сервера (например 500)', async () => {
    const serverError = new Error('Server error') as Error & { status: number };
    serverError.status = 500;
    vi.spyOn(services.callService, 'getCallHistory').mockRejectedValueOnce(serverError);

    const options = callHistoryInfiniteQuery();
    await expect(options.queryFn({ pageParam: '' } as any)).rejects.toThrow('Server error');
  });

  it('getNextPageParam возвращает nextCursor при hasMore: true и undefined при hasMore: false', () => {
    const options = callHistoryInfiniteQuery();
    expect(
      options.getNextPageParam(
        { calls: [], nextCursor: 'cur-2', hasMore: true } as any,
        [] as any,
        '' as any,
        [] as any
      )
    ).toBe('cur-2');

    expect(
      options.getNextPageParam(
        { calls: [], nextCursor: 'cur-2', hasMore: false } as any,
        [] as any,
        '' as any,
        [] as any
      )
    ).toBeUndefined();
  });

  describe('flattenCallHistory', () => {
    it('объединяет страницы и удаляет дубликаты вызовов по id/roomId', () => {
      const pages: ICallHistoryResponse[] = [
        {
          calls: [
            {
              id: 'call-1',
              roomId: 'room-1',
              peerId: 'peer-1',
              direction: 'incoming',
              kind: 'audio',
              status: 'answered',
              startedAt: '2026-10-09T10:00:00Z',
              durationSeconds: 60,
            },
            {
              id: 'call-2',
              roomId: 'room-2',
              peerId: 'peer-2',
              direction: 'outgoing',
              kind: 'video',
              status: 'answered',
              startedAt: '2026-10-09T09:00:00Z',
              durationSeconds: 120,
            },
          ],
          nextCursor: 'cur-2',
          hasMore: true,
        },
        {
          calls: [
            // Дубликат первого звонка
            {
              id: 'call-1',
              roomId: 'room-1',
              peerId: 'peer-1',
              direction: 'incoming',
              kind: 'audio',
              status: 'answered',
              startedAt: '2026-10-09T10:00:00Z',
              durationSeconds: 60,
            },
            {
              id: 'call-3',
              roomId: 'room-3',
              peerId: 'peer-3',
              direction: 'incoming',
              kind: 'audio',
              status: 'missed',
              startedAt: '2026-10-09T08:00:00Z',
              durationSeconds: 0,
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      ];

      const flat = flattenCallHistory(pages);
      expect(flat).toHaveLength(3);
      expect(flat.map((c) => c.id)).toEqual(['call-1', 'call-2', 'call-3']);
    });

    it('возвращает пустой массив для undefined', () => {
      expect(flattenCallHistory(undefined)).toEqual([]);
    });
  });
});
