import { apiClient, API_ENDPOINTS } from '@/shared/api';
import {
  pushAvailability,
  readPushSubscriptionId,
  vapidKeyToBytes,
  writePushSubscriptionId,
  type TPushAvailability,
} from '@/shared/lib';
import { create } from 'zustand';

/*
 * Push-уведомления на этом устройстве (#882). Сервер — #717.
 *
 * Подписка — у браузера (PushManager), её id на сервере — в localStorage:
 * по нему сервер не шлёт push на устройство, где приложение на экране.
 */

/**
 * - on / off — включены или нет на этом устройстве;
 * - denied — запрещены в настройках браузера: из приложения не включить;
 * - needs-install — iPhone вне установленного приложения;
 * - unsupported — браузер не умеет;
 * - unavailable — на сервере push не настроен.
 */
export type TPushStatus = 'on' | 'off' | 'denied' | 'needs-install' | 'unsupported' | 'unavailable';

interface IPushState {
  status: TPushStatus;
  subscriptionId: string | null;
  busy: boolean;
}

export const usePushStore = create<IPushState>(() => ({
  status: 'off',
  subscriptionId: readPushSubscriptionId(),
  busy: false,
}));

/** Всё, что нужно снаружи, — подменяется в тестах. */
export interface IPushDeps {
  availability: () => TPushAvailability;
  permission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  registration: () => Promise<ServiceWorkerRegistration>;
  vapidKey: () => Promise<string | null>;
  saveSubscription: (subscription: PushSubscriptionJSON) => Promise<string>;
  deleteSubscription: (endpoint: string) => Promise<void>;
}

async function fetchVapidKey(): Promise<string | null> {
  try {
    const response = await apiClient.get<{ publicKey: string }>(API_ENDPOINTS.PUSH_VAPID_KEY);
    return response.data?.publicKey || null;
  } catch (error) {
    // 404 push_not_configured — push на сервере выключен.
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

export const browserPushDeps: IPushDeps = {
  availability: () => pushAvailability(),
  permission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  registration: () => navigator.serviceWorker.ready,
  vapidKey: fetchVapidKey,
  saveSubscription: async (subscription) => {
    const response = await apiClient.post<{ id: string }>(
      API_ENDPOINTS.PUSH_SUBSCRIPTIONS,
      subscription
    );
    return response.data.id;
  },
  deleteSubscription: async (endpoint) => {
    await apiClient.delete(API_ENDPOINTS.PUSH_SUBSCRIPTIONS, { endpoint });
  },
};

function setStatus(status: TPushStatus, subscriptionId: string | null) {
  writePushSubscriptionId(subscriptionId);
  usePushStore.setState({ status, subscriptionId, busy: false });
}

/** Состояние без побочных эффектов: только то, что уже известно. */
function baseStatus(deps: IPushDeps): TPushStatus | null {
  const availability = deps.availability();
  if (availability !== 'supported') return availability;
  if (deps.permission() === 'denied') return 'denied';
  return null;
}

async function subscribeAndRegister(deps: IPushDeps): Promise<void> {
  const key = await deps.vapidKey();
  if (!key) {
    setStatus('unavailable', null);
    return;
  }
  const registration = await deps.registration();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyToBytes(key) as BufferSource,
    }));
  const id = await deps.saveSubscription(subscription.toJSON());
  setStatus('on', id);
}

/**
 * Включить — только по нажатию: iPhone разрешает спросить разрешение лишь
 * в обработчике жеста, поэтому запрос разрешения — первым, до любого
 * ожидания.
 */
export async function enablePush(deps: IPushDeps = browserPushDeps): Promise<TPushStatus> {
  const unavailable = baseStatus(deps);
  if (unavailable) {
    setStatus(unavailable, null);
    return unavailable;
  }
  const permissionRequest = deps.requestPermission();
  usePushStore.setState({ busy: true });
  try {
    const permission = await permissionRequest;
    if (permission !== 'granted') {
      setStatus(permission === 'denied' ? 'denied' : 'off', null);
    } else {
      await subscribeAndRegister(deps);
    }
  } catch (error) {
    console.warn('Push не включился', error);
    setStatus('off', null);
  }
  return usePushStore.getState().status;
}

/** Выключить на этом устройстве: сервер забывает подписку, браузер — тоже. */
export async function disablePush(deps: IPushDeps = browserPushDeps): Promise<void> {
  usePushStore.setState({ busy: true });
  try {
    const registration = await deps.registration();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await deps.deleteSubscription(subscription.endpoint).catch(() => undefined);
      await subscription.unsubscribe();
    }
  } catch (error) {
    console.warn('Push не выключился', error);
  }
  setStatus(baseStatus(deps) ?? 'off', null);
}

/**
 * При входе и запуске: включённое раньше — подтвердить серверу (подписка
 * могла смениться, аккаунт — тоже), разрешение отозвали — забыть. Ничего
 * не спрашивает: только то, что человек уже разрешил.
 */
export async function syncPush(deps: IPushDeps = browserPushDeps): Promise<void> {
  const unavailable = baseStatus(deps);
  if (unavailable) {
    setStatus(unavailable, null);
    return;
  }
  const wasEnabled = Boolean(readPushSubscriptionId());
  if (deps.permission() !== 'granted' || !wasEnabled) {
    setStatus('off', null);
    return;
  }
  try {
    await subscribeAndRegister(deps);
  } catch (error) {
    console.warn('Push не восстановился', error);
    setStatus('off', null);
  }
}
