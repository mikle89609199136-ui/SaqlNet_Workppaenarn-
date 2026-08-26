import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { services } from '@/services/serviceContainer';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

describe('поиск пользователей', () => {
  it('should return an empty list when the server sends no users', async () => {
    // Сервер отвечает `users: null`, когда никто не нашёлся. Вызывающий код
    // рисует результат списком, и без приведения к массиву страница создания
    // группы падала прямо во время набора запроса.
    server.use(http.get(api('/users/search'), () => HttpResponse.json({ users: null })));

    await expect(services.chatService.searchUsers('никого')).resolves.toEqual([]);
  });

  it('should return the users the server sent', async () => {
    server.use(
      http.get(api('/users/search'), () =>
        HttpResponse.json({ users: [{ id: 'user-2', username: 'boris' }] })
      )
    );

    const found = await services.chatService.searchUsers('boris');

    expect(found.map((user) => user.username)).toEqual(['boris']);
  });
});
