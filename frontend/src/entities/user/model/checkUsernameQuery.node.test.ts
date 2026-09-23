import { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { checkUsernameQuery } from './checkUsernameQuery';

describe('checkUsernameQuery', () => {
  it('запрашивает доступность имени пользователя и нормализует символ @', async () => {
    let requestedUsername = '';
    server.use(
      http.get(api('/users/check-username'), ({ request }) => {
        const url = new URL(request.url);
        requestedUsername = url.searchParams.get('username') || '';
        return HttpResponse.json({ available: true });
      })
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = await queryClient.fetchQuery(checkUsernameQuery('@alexandra'));

    expect(requestedUsername).toBe('alexandra');
    expect(result).toEqual({ available: true });
  });

  it('возвращает false если имя уже занято', async () => {
    server.use(
      http.get(api('/users/check-username'), () => HttpResponse.json({ available: false }))
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = await queryClient.fetchQuery(checkUsernameQuery('taken_user'));

    expect(result).toEqual({ available: false });
  });

  it('возвращает null при 401 unauthorized (неавторизованный пользователь в мастере)', async () => {
    server.use(
      http.get(api('/users/check-username'), () =>
        HttpResponse.json({ code: 'missing_token', message: 'Unauthorized' }, { status: 401 })
      )
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = await queryClient.fetchQuery(checkUsernameQuery('newuser'));

    expect(result).toBeNull();
  });

  it('пробрасывает другие ошибки сервера (500)', async () => {
    server.use(
      http.get(api('/users/check-username'), () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
      )
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(queryClient.fetchQuery(checkUsernameQuery('failuser'))).rejects.toThrow();
  });
});
