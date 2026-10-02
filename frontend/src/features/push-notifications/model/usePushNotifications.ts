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
    const send = (visible: boolean) => {
      try {
        socket.send({ type: 'client_state', visible, pushSubscriptionId: subscriptionId ?? '' });
      } catch {
        // Сокет ещё не подключён — отчитаемся на socket:connected.
      }
    };
    const report = () => send(document.visibilityState === 'visible');
    // Страницу выгружают или замораживают (iPhone усыпляет приложение):
    // «не на экране» — сразу. Иначе сервер считает устройство видимым,
    // пока сам не оборвёт сокет по тайм-ауту, и push всё это время ждёт.
    const leave = () => send(false);
    report();
    const unsubscribe = eventBus.on(WS_EVENTS.SOCKET.CONNECTED, report);
    document.addEventListener('visibilitychange', report);
    document.addEventListener('freeze', leave);
    window.addEventListener('pagehide', leave);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', report);
      document.removeEventListener('freeze', leave);
      window.removeEventListener('pagehide', leave);
    };
  }, [signedIn, socket, eventBus, subscriptionId]);
}
