import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPushSubscriptionId, writePushSubscriptionId } from '@/shared/lib';
import {
  disablePush,
  enablePush,
  syncPush,
  usePushStore,
  type IPushDeps,
} from './pushNotifications';

function fakeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/device') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

function makeDeps(overrides: Partial<IPushDeps> = {}) {
  const calls: string[] = [];
  let current: ReturnType<typeof fakeSubscription> | null = null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      calls.push('subscribe');
      current = fakeSubscription();
      return current;
    }),
  };
  const deps: IPushDeps = {
    availability: () => 'supported',
    permission: () => 'default',
    requestPermission: vi.fn(async () => {
      calls.push('requestPermission');
      return 'granted' as NotificationPermission;
    }),
    registration: async () => ({ pushManager }) as unknown as ServiceWorkerRegistration,
    vapidKey: vi.fn(async () => {
      calls.push('vapidKey');
      return 'BAEC';
    }),
    saveSubscription: vi.fn(async () => {
      calls.push('save');
      return 'sub-id-1';
    }),
    deleteSubscription: vi.fn(async () => undefined),
    ...overrides,
  };
  return {
    deps,
    calls,
    pushManager,
    setCurrent: (sub: ReturnType<typeof fakeSubscription> | null) => (current = sub),
  };
}

beforeEach(() => {
  writePushSubscriptionId(null);
  usePushStore.setState({ status: 'off', subscriptionId: null, busy: false });
});

/* Включение и выключение push на устройстве (#882). */
describe('push на этом устройстве', () => {
  it('включение: разрешение спрашивается первым — в жесте, до любого ожидания', async () => {
    const { deps, calls } = makeDeps();

    const status = await enablePush(deps);

    expect(status).toBe('on');
    expect(calls).toEqual(['requestPermission', 'vapidKey', 'subscribe', 'save']);
    expect(usePushStore.getState().subscriptionId).toBe('sub-id-1');
    expect(readPushSubscriptionId()).toBe('sub-id-1');
    expect(deps.saveSubscription).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/device',
      keys: { p256dh: 'p', auth: 'a' },
    });
  });

  it('уже подписанное устройство не подписывается заново', async () => {
    const { deps, pushManager, setCurrent } = makeDeps();
    setCurrent(fakeSubscription());

    await enablePush(deps);

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(usePushStore.getState().status).toBe('on');
  });

  it('отказ в разрешении — «запрещено», без подписки', async () => {
    const { deps, pushManager } = makeDeps({
      requestPermission: vi.fn(async () => 'denied' as NotificationPermission),
    });

    expect(await enablePush(deps)).toBe('denied');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(readPushSubscriptionId()).toBeNull();
  });

  it('на сервере push не настроен — «недоступно»', async () => {
    const { deps, pushManager } = makeDeps({ vapidKey: vi.fn(async () => null) });

    expect(await enablePush(deps)).toBe('unavailable');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('iPhone вне установленного приложения — разрешение даже не спрашивается', async () => {
    const { deps } = makeDeps({ availability: () => 'needs-install' });

    expect(await enablePush(deps)).toBe('needs-install');
    expect(deps.requestPermission).not.toHaveBeenCalled();
  });

  it('сбой подписки — выключено, без исключения наружу', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps } = makeDeps({
      saveSubscription: vi.fn(async () => Promise.reject(new Error('500'))),
    });

    expect(await enablePush(deps)).toBe('off');
    expect(readPushSubscriptionId()).toBeNull();
    warn.mockRestore();
  });

  it('выключение: сервер забывает подписку, браузер отписывается', async () => {
    const { deps, setCurrent } = makeDeps();
    const subscription = fakeSubscription();
    setCurrent(subscription);
    writePushSubscriptionId('sub-id-1');
    usePushStore.setState({ status: 'on', subscriptionId: 'sub-id-1' });

    await disablePush(deps);

    expect(deps.deleteSubscription).toHaveBeenCalledWith(subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(usePushStore.getState()).toMatchObject({ status: 'off', subscriptionId: null });
    expect(readPushSubscriptionId()).toBeNull();
  });

  it.each(['server', 'browser'] as const)(
    'при ошибке отключения %s сохраняет статус, id подписки и снимает busy',
    async (failure) => {
      const { deps, setCurrent } = makeDeps();
      const subscription = fakeSubscription();
      setCurrent(subscription);
      writePushSubscriptionId('sub-id-1');
      usePushStore.setState({ status: 'on', subscriptionId: 'sub-id-1' });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      if (failure === 'server') {
        vi.mocked(deps.deleteSubscription).mockRejectedValueOnce(new Error('network'));
      } else {
        subscription.unsubscribe.mockRejectedValueOnce(new Error('browser'));
      }
      await disablePush(deps);
      expect(usePushStore.getState()).toMatchObject({
        status: 'on',
        subscriptionId: 'sub-id-1',
        busy: false,
      });
      expect(readPushSubscriptionId()).toBe('sub-id-1');
      if (failure === 'server') expect(subscription.unsubscribe).not.toHaveBeenCalled();
      warn.mockRestore();
    }
  );

  describe('при входе', () => {
    it('включённое раньше — подтверждается серверу, без вопросов', async () => {
      const { deps, setCurrent } = makeDeps({ permission: () => 'granted' });
      setCurrent(fakeSubscription());
      writePushSubscriptionId('old-id');

      await syncPush(deps);

      expect(deps.requestPermission).not.toHaveBeenCalled();
      expect(deps.saveSubscription).toHaveBeenCalled();
      expect(usePushStore.getState()).toMatchObject({ status: 'on', subscriptionId: 'sub-id-1' });
    });

    it('не включали — ничего не делает', async () => {
      const { deps } = makeDeps({ permission: () => 'granted' });

      await syncPush(deps);

      expect(deps.saveSubscription).not.toHaveBeenCalled();
      expect(usePushStore.getState().status).toBe('off');
    });

    it('разрешение отозвали в браузере — «запрещено», id забыт', async () => {
      const { deps } = makeDeps({ permission: () => 'denied' });
      writePushSubscriptionId('old-id');

      await syncPush(deps);

      expect(usePushStore.getState().status).toBe('denied');
      expect(readPushSubscriptionId()).toBeNull();
    });
  });
});
