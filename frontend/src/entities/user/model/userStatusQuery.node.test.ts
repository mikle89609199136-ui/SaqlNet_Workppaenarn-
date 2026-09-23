import { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { userStatusQuery } from './userStatusQuery';

describe('userStatusQuery', () => {
  it('запрашивает статус присутствия конкретного пользователя', async () => {
    server.use(
      http.get(api('/users/:userId/status'), ({ params }) => {
        expect(params.userId).toBe('user-42');
        return HttpResponse.json({ isOnline: true, lastSeen: 'recently' });
      })
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = await queryClient.fetchQuery(userStatusQuery('user-42'));

    expect(result).toEqual({ isOnline: true, lastSeen: 'recently' });
  });

  it('содержит корректный refetchInterval и staleTime', () => {
    const options = userStatusQuery('user-42');
    expect(options.queryKey).toEqual(['user', 'status', 'user-42']);
    expect(options.staleTime).toBe(30000);
    expect(options.refetchInterval).toBe(30000);
    expect(options.enabled).toBe(true);
  });
});
