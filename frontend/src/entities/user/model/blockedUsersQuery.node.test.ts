import { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { blockedUsersQuery } from './blockedUsersQuery';
import { userKeys } from './userKeys';

describe('запрос заблокированных пользователей (blockedUsersQuery)', () => {
  it('should have the correct query key', () => {
    expect(blockedUsersQuery().queryKey).toEqual(userKeys.blocked());
    expect(userKeys.blocked()).toEqual(['user', 'blocked']);
  });

  it('should fetch the list of blocked users from the server', async () => {
    const mockBlocked = [
      {
        id: 'user-b1',
        username: 'blocked_user',
        firstName: 'Blocked',
        lastName: 'User',
        avatarUrl: '',
        blockedAt: '2026-01-01T00:00:00Z',
      },
    ];

    server.use(
      http.get(api('/users/blocked'), () => {
        return HttpResponse.json({ blocked: mockBlocked });
      })
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = await queryClient.fetchQuery(blockedUsersQuery());

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'user-b1',
      username: 'blocked_user',
    });
  });

  it('should refetch after invalidation', async () => {
    let requests = 0;
    server.use(
      http.get(api('/users/blocked'), () => {
        requests += 1;
        return HttpResponse.json({ blocked: [] });
      })
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await queryClient.fetchQuery(blockedUsersQuery());
    await queryClient.invalidateQueries({ queryKey: userKeys.blocked() });
    await queryClient.fetchQuery(blockedUsersQuery());

    expect(requests).toBe(2);
  });
});
