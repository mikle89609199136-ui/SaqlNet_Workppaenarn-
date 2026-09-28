/**
 * Web Push в браузере (#882): что умеет устройство, подписка и отписка.
 * Сервер и интерфейс — в features/push-notifications; здесь — только то,
 * что нужно и при выходе из аккаунта.
 */

/** Где хранится id подписки этого устройства на сервере. */
export const PUSH_SUBSCRIPTION_ID_KEY = 'craneapp_push_subscription_id';

/**
 * - supported — можно включить;
 * - needs-install — iPhone/iPad вне установленного приложения: push там
 *   только у приложения на экране «Домой» (iOS 16.4+);
 * - unsupported — браузер не умеет или это сборка разработки (service
 *   worker регистрируется только в продакшене).
 */
export type TPushAvailability = 'supported' | 'needs-install' | 'unsupported';

export interface IPushEnv {
  isProduction: boolean;
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

export function browserPushEnv(): IPushEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const win = typeof window === 'undefined' ? undefined : window;
  return {
    isProduction: import.meta.env.PROD,
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone:
      Boolean(win?.matchMedia?.('(display-mode: standalone)').matches) ||
      (nav as Navigator & { standalone?: boolean })?.standalone === true,
    hasServiceWorker: Boolean(nav && 'serviceWorker' in nav),
    hasPushManager: Boolean(win && 'PushManager' in win),
    hasNotification: Boolean(win && 'Notification' in win),
  };
}

function isAppleMobile(env: IPushEnv): boolean {
  // iPadOS притворяется Mac: отличается сенсорным экраном.
  return (
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)
  );
}

export function pushAvailability(env: IPushEnv = browserPushEnv()): TPushAvailability {
  if (isAppleMobile(env) && !env.standalone) return 'needs-install';
  if (!env.isProduction) return 'unsupported';
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  return 'supported';
}

/** Ключ VAPID (base64url) → байты для PushManager.subscribe. */
export function vapidKeyToBytes(key: string): Uint8Array {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function readPushSubscriptionId(): string | null {
  try {
    return localStorage.getItem(PUSH_SUBSCRIPTION_ID_KEY);
  } catch {
    return null;
  }
}

export function writePushSubscriptionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(PUSH_SUBSCRIPTION_ID_KEY, id);
    else localStorage.removeItem(PUSH_SUBSCRIPTION_ID_KEY);
  } catch {
    // приватный режим — id живёт до перезагрузки
  }
}

async function currentRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('/')) ?? null;
}

/** Адрес push-подписки этого устройства, если она есть. */
export async function currentPushEndpoint(): Promise<string | null> {
  try {
    const registration = await currentRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}

/**
 * Отписать это устройство — при выходе из аккаунта. Сервер забывает
 * подписку отдельно (AuthService — пока токен действует); не успел —
 * узнает при следующей отправке: push-сервис ответит 410.
 */
export async function unsubscribePushOnDevice(): Promise<void> {
  writePushSubscriptionId(null);
  try {
    const registration = await currentRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Не вышло — подписка осталась у браузера, но сервер её уже не
    // свяжет с этим аккаунтом после следующего входа: она перепишется.
  }
}
