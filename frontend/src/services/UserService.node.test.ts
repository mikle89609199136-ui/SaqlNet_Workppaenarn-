import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

describe('UserService: новые эндпоинты (#598)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkUsername', () => {
    it('отправляет GET /users/check-username с параметром username и возвращает availability', async () => {
      let queryParam = '';
      server.use(
        http.get(api('/users/check-username'), ({ request }) => {
          const url = new URL(request.url);
          queryParam = url.searchParams.get('username') || '';
          return HttpResponse.json({ available: true });
        })
      );

      const result = await services.userService.checkUsername('maximdon');
      expect(queryParam).toBe('maximdon');
      expect(result).toEqual({ available: true });
    });

    it('корректно возвращает available: false для занятого имени', async () => {
      server.use(
        http.get(api('/users/check-username'), () => {
          return HttpResponse.json({ available: false });
        })
      );

      const result = await services.userService.checkUsername('occupied_user');
      expect(result).toEqual({ available: false });
    });
  });

  describe('getStatus', () => {
    it('отправляет GET /users/:id/status и возвращает онлайн-статус', async () => {
      server.use(
        http.get(api('/users/user-123/status'), () => {
          return HttpResponse.json({ isOnline: true, lastSeen: '2026-09-23T15:00:00Z' });
        })
      );

      const result = await services.userService.getStatus('user-123');
      expect(result).toEqual({ isOnline: true, lastSeen: '2026-09-23T15:00:00Z' });
    });
  });
});

