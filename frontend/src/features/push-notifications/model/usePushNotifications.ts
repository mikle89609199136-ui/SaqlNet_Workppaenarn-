import { useRealtimeSocket } from '@/shared/api';
import { WS_EVENTS } from '@/shared/config';
import { useEffect } from 'react';
import { syncPush, usePushStore } from './pushNotifications';

/**
 * Push на уровне приложения (#882), пока человек вошёл:
 *
 * - подписка, включённая раньше, подтверждается серверу (могла смениться);
 * - серверу сообщается, на экране ли приложение, вместе с id подписки
 *   этого устройства: на видимое устройство push не отправляется. При
 *   каждом (пере)подключении сокета и при сворачивании/разворачивании.
 */
export function usePushNotifications(signedIn: boolean, sync: () => Promise<void> = syncPush) {
  const { socket, eventBus } = useRealtimeSocket(signedIn);
  const subscriptionId = usePushStore((state) => state.subscriptionId);

  useEffect(() => {
    if (signedIn) void sync();
  }, [signedIn, sync]);

  useEffect(() => {
    if (!signedIn) return undefined;
    const report = () => {
      try {
        socket.send({
          type: 'client_state',
          visible: document.visibilityState === 'visible',
          pushSubscriptionId: subscriptionId ?? '',
        });
      } catch {
        // Сокет ещё не подключён — отчитаемся на socket:connected.
      }
    };
    report();
    const unsubscribe = eventBus.on(WS_EVENTS.SOCKET.CONNECTED, report);
    document.addEventListener('visibilitychange', report);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', report);
    };
  }, [signedIn, socket, eventBus, subscriptionId]);
}
