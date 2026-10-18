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

  describe('updateUsername', () => {
    it('отправляет PUT /users/me/username с новым именем и возвращает обновлённого пользователя', async () => {
      let requestBody: unknown;
      server.use(
        http.put(api('/users/me/username'), async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({
            user: { id: 'user-me', username: 'new_nick', firstName: 'Иван' },
          });
        })
      );

      const result = await services.userService.updateUsername('new_nick');
      expect(requestBody).toEqual({ username: 'new_nick' });
      expect(result).toEqual({ id: 'user-me', username: 'new_nick', firstName: 'Иван' });
    });
  });
});

describe('UserService: канонический Settings API (#498)', () => {
  it('читает settings и privacy одним GET, сохраняя оба раздела ответа', async () => {
    const payload = {
      settings: { theme: 'light', notifications: false },
      privacy: { calls: 'nobody', lastSeen: 'all' },
    };
    let credentials: RequestCredentials | undefined;
    server.use(
      http.get(api('/users/settings'), ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json(payload);
      })
    );

    await expect(services.userService.getSettings()).resolves.toEqual(payload);
    expect(credentials).toBe('same-origin');
  });

  it('отправляет flat patch settings и возвращает итоговый раздел сервера', async () => {
    let requestBody: unknown;
    const resultingSettings = { theme: 'light', language: 'en', notifications: false };
    server.use(
      http.put(api('/users/settings'), async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ settings: resultingSettings });
      })
    );

    await expect(services.userService.updateSettings({ theme: 'light' })).resolves.toEqual(
      resultingSettings
    );
    expect(requestBody).toEqual({ theme: 'light' });
  });

  it('пишет privacy отдельным flat patch и возвращает итоговые правила', async () => {
    let requestBody: unknown;
    const resultingPrivacy = { calls: 'nobody', lastSeen: 'all' };
    server.use(
      http.put(api('/users/privacy'), async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ privacy: resultingPrivacy });
      })
    );

    await expect(services.userService.updatePrivacy({ calls: 'nobody' })).resolves.toEqual(
      resultingPrivacy
    );
    expect(requestBody).toEqual({ calls: 'nobody' });
  });

  it.each([
    { status: 400, code: 'validation_failed' },
    { status: 403, code: 'cross_site_request' },
  ])('сохраняет HTTP $status и code $code при отказе записи', async ({ status, code }) => {
    server.use(
      http.put(api('/users/privacy'), () =>
        HttpResponse.json(
          { code, message: 'request failed', requestId: 'settings-498' },
          { status }
        )
      )
    );

    await expect(services.userService.updatePrivacy({ calls: 'nobody' })).rejects.toMatchObject({
      status,
      code,
      data: { requestId: 'settings-498' },
    });
  });
});
