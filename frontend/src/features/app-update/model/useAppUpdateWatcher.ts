import { useEffect } from 'react';
import { WS_EVENTS } from '@/shared/config';
import { eventBus } from '@/shared/lib/event-bus';
import { checkForUpdate } from './appUpdate';

/** Пока приложение открыто — сверяться с сервером раз в полчаса. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;

/**
 * Когда проверять обновление (#892):
 * - сразу при запуске — ожидающий worker от прошлой сессии включится молча;
 * - при возврате в приложение: iPhone возвращает его из памяти, без загрузки
 *   страницы, и сам браузер проверку не делает;
 * - при переподключении сокета: после деплоя сервер перезапускается, и это
 *   самый точный признак новой сборки;
 * - раз в полчаса, пока открыто.
 *
 * Частоту ограничивает checkForUpdate: не чаще раза в минуту.
 */
export function useAppUpdateWatcher(check: () => unknown = checkForUpdate) {
  useEffect(() => {
    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = eventBus.on(WS_EVENTS.SOCKET.CONNECTED, () => void check());
    const timer = window.setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [check]);
}
