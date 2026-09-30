import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentPushEndpoint,
  pushAvailability,
  unsubscribePushOnDevice,
  readPushSubscriptionId,
  vapidKeyToBytes,
  writePushSubscriptionId,
  type IPushEnv,
} from './push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile';

const env = (overrides: Partial<IPushEnv> = {}): IPushEnv => ({
  isProduction: true,
  userAgent: ANDROID,
  maxTouchPoints: 5,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  ...overrides,
});

/* Где push можно включить (#882). */
describe('доступность push', () => {
  afterEach(() => writePushSubscriptionId(null));

  it('Android и компьютер — можно', () => {
    expect(pushAvailability(env())).toBe('supported');
    expect(
      pushAvailability(env({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0 }))
    ).toBe('supported');
  });

  it('iPhone и iPad вне установленного приложения — сначала установить', () => {
    expect(pushAvailability(env({ userAgent: IPHONE }))).toBe('needs-install');
    // iPadOS притворяется Mac, выдаёт его сенсорный экран.
    expect(pushAvailability(env({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }))).toBe(
      'needs-install'
    );
    // Настоящий Mac — нет.
    expect(pushAvailability(env({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 }))).toBe('supported');
  });

  it('iPhone, приложение на экране «Домой» — можно', () => {
    expect(pushAvailability(env({ userAgent: IPHONE, standalone: true }))).toBe('supported');
  });

  it('браузер без Push API и сборка разработки — нельзя', () => {
    expect(pushAvailability(env({ hasPushManager: false }))).toBe('unsupported');
    expect(pushAvailability(env({ hasServiceWorker: false }))).toBe('unsupported');
    expect(pushAvailability(env({ hasNotification: false }))).toBe('unsupported');
    expect(pushAvailability(env({ isProduction: false }))).toBe('unsupported');
  });

  it('ключ VAPID из base64url — в байты', () => {
    const bytes = vapidKeyToBytes('BAEC_-8');
    expect(Array.from(bytes)).toEqual([4, 1, 2, 255, 239]);
  });

  it('id подписки устройства хранится и стирается', () => {
    writePushSubscriptionId('sub-1');
    expect(readPushSubscriptionId()).toBe('sub-1');
    writePushSubscriptionId(null);
    expect(readPushSubscriptionId()).toBeNull();
  });
});

/* Выход не должен зависеть от push (#705): браузер без push-сервиса может
   не ответить на getSubscription() вовсе — тогда ждём недолго и идём дальше. */
describe('push при выходе из аккаунта', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('браузер не отвечает — адрес подписки null, отписка завершается', async () => {
    const hanging = { pushManager: { getSubscription: () => new Promise(() => {}) } };
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => hanging } });

    await expect(currentPushEndpoint(20)).resolves.toBeNull();
    await expect(unsubscribePushOnDevice(20)).resolves.toBeUndefined();
  });

  it('подписка есть — её адрес и отписка', async () => {
    const unsubscribe = vi.fn(async () => true);
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', unsubscribe };
    const registration = { pushManager: { getSubscription: async () => subscription } };
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } });

    await expect(currentPushEndpoint()).resolves.toBe(subscription.endpoint);
    await unsubscribePushOnDevice();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
