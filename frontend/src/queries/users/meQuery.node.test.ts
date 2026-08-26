import { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { meQuery } from './meQuery';
import { settingsQuery } from './settingsQuery';

function countingHandler(path: string, body: unknown) {
  const state = { requests: 0 };
  server.use(
    http.get(api(path), () => {
      state.requests += 1;
      return HttpResponse.json(body);
    })
  );
  return state;
}

describe('профиль текущего пользователя', () => {
  it('should be fetched once for a loader and a page reading it afterwards', async () => {
    // Загрузчик защищённой ветки срабатывает на каждой навигации, а экран
    // настроек запрашивал профиль отдельно: два обращения к /users/me за
    // одно открытие страницы (#223).
    const calls = countingHandler('/users/me', { user: { id: 'user-1', username: 'tester' } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await queryClient.fetchQuery(meQuery());
    await queryClient.fetchQuery(meQuery());
    const user = await queryClient.fetchQuery(meQuery());

    expect(calls.requests).toBe(1);
    expect(user).toMatchObject({ id: 'user-1' });
  });

  it('should refetch after the profile was invalidated', async () => {
    const calls = countingHandler('/users/me', { user: { id: 'user-1', username: 'tester' } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await queryClient.fetchQuery(meQuery());
    await queryClient.invalidateQueries({ queryKey: meQuery().queryKey });
    await queryClient.fetchQuery(meQuery());

    expect(calls.requests).toBe(2);
  });
});

describe('настройки', () => {
  it('should keep settings and privacy in one response', async () => {
    // Разделение на два запроса дало бы два состояния загрузки на экране,
    // который сервер обслуживает одним ответом.
    countingHandler('/users/settings', {
      settings: { theme: 'dark' },
      privacy: { lastSeen: 'all' },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const payload = await queryClient.fetchQuery(settingsQuery());

    expect(payload).toMatchObject({ settings: { theme: 'dark' }, privacy: { lastSeen: 'all' } });
  });
});
