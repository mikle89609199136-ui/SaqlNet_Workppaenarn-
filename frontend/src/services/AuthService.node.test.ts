import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './AuthService';

describe('AuthService session metadata', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    {
      call: (service: AuthService) => service.login({ username: 'anna', password: 'secret' }),
      endpoint: '/auth/login',
      input: { username: 'anna', password: 'secret' },
    },
    {
      call: (service: AuthService) =>
        service.register({ username: 'anna', password: 'secret', firstName: 'Anna' }),
      endpoint: '/auth/register',
      input: { username: 'anna', password: 'secret', firstName: 'Anna' },
    },
  ])('sends the device on $endpoint', async ({ call, endpoint, input }) => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36',
    });
    const post = vi.fn().mockResolvedValue({ data: { user: { id: 'user-id' } } });
    const service = new AuthService({ post }, { setUser: vi.fn() });

    await call(service);

    expect(post).toHaveBeenCalledWith(endpoint, {
      ...input,
      deviceName: 'Chrome · Linux',
      deviceType: 'desktop',
    });
  });
});

describe('AuthService.logoutAll', () => {
  it('clears the local profile only after the server confirms revocation', async () => {
    const post = vi.fn().mockResolvedValue({ data: { success: true } });
    const clearProfile = vi.fn();
    const service = new AuthService({ post }, { clearProfile });

    await service.logoutAll();

    expect(clearProfile).toHaveBeenCalledOnce();
  });

  it('keeps the local profile when server-side revocation fails', async () => {
    const failure = new Error('service unavailable');
    const post = vi.fn().mockRejectedValue(failure);
    const clearProfile = vi.fn();
    const service = new AuthService({ post }, { clearProfile });

    await expect(service.logoutAll()).rejects.toBe(failure);
    expect(clearProfile).not.toHaveBeenCalled();
  });
});

/* Выход — push этому устройству больше не нужен (#882). */
describe('AuthService: push при выходе', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/device';

  function withSubscription() {
    const unsubscribe = vi.fn(async () => true);
    const subscription = { endpoint, unsubscribe };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => subscription },
        }),
      },
    });
    return unsubscribe;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('выход: сервер забывает подписку, пока токен действует; браузер отписывается', async () => {
    const unsubscribe = withSubscription();
    const calls: string[] = [];
    const post = vi.fn(async () => {
      calls.push('logout');
      return { data: {} };
    });
    const del = vi.fn(async () => {
      calls.push('delete-subscription');
      return { data: {} };
    });
    const service = new AuthService({ post, delete: del }, { clearProfile: vi.fn() });

    await service.logout();

    expect(del).toHaveBeenCalledWith('/users/push/subscriptions', { endpoint });
    expect(calls).toEqual(['delete-subscription', 'logout']);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('выход со всех устройств: подписки удалил сервер — браузер только отписывается', async () => {
    const unsubscribe = withSubscription();
    const del = vi.fn();
    const service = new AuthService(
      { post: vi.fn().mockResolvedValue({ data: {} }), delete: del },
      { clearProfile: vi.fn() }
    );

    await service.logoutAll();

    expect(del).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('сбой удаления на сервере не мешает выйти', async () => {
    withSubscription();
    const clearProfile = vi.fn();
    const service = new AuthService(
      {
        post: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockRejectedValue(new Error('500')),
      },
      { clearProfile }
    );

    await service.logout();
    expect(clearProfile).toHaveBeenCalled();
  });
});
