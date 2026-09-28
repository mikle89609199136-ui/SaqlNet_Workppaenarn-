import { useRealtimeSocket } from '@/shared/api';
import { decryptChatLastMessagePreview } from '@/services/decryptChatPreview';
import { useProfileStore } from '@/entities/user';
import { usePushNotifications, usePushStore } from '@/features/push-notifications';
import type { ILastMessageDto } from '@/types';
import { useEffect } from 'react';

const FALLBACK_BODY = 'Новое сообщение';
const MAX_BODY_LENGTH = 120;

/**
 * Готовит текст уведомления.
 *
 * Содержимое сообщения приходит зашифрованным, поэтому его нужно провести
 * через ту же расшифровку, что и превью в списке чатов. Уведомление —
 * единственное место, где текст покидает вкладку и попадает в систему:
 * сюда не должен просочиться ни шифртекст, ни служебный плейсхолдер.
 */
async function resolveNotificationBody(chatId: string, message: ILastMessageDto): Promise<string> {
  if (typeof message?.content !== 'string' || !message.content) return FALLBACK_BODY;

  try {
    const decrypted = await decryptChatLastMessagePreview(chatId, message);
    const text = decrypted?.content;

    if (typeof text !== 'string' || !text) return FALLBACK_BODY;
    // Расшифровать не удалось: сервис возвращает исходный payload либо
    // заглушку с причиной. В уведомлении не место ни тому, ни другому.
    if (decrypted?.undecryptable) return FALLBACK_BODY;
    if (text.startsWith('{')) return FALLBACK_BODY;

    return text.slice(0, MAX_BODY_LENGTH);
  } catch {
    return FALLBACK_BODY;
  }
}

/** Нажали на push-уведомление при открытом приложении — перейти без перезагрузки. */
function isNavigateRequest(data: unknown): data is { type: 'craneapp:navigate'; url: string } {
  const message = data as { type?: unknown; url?: unknown } | null;
  return (
    message?.type === 'craneapp:navigate' &&
    typeof message.url === 'string' &&
    // Только свои пути: «//evil.example» — уже чужой адрес.
    message.url.startsWith('/') &&
    !message.url.startsWith('//')
  );
}

/*
 * Разрешение на уведомления здесь больше не спрашивается при загрузке
 * (#882): iPhone разрешает спросить только по нажатию, а в браузере
 * запрос без повода раздражает. Спрашивает плашка в списке чатов и
 * переключатель в настройках.
 */
export function NotificationManager() {
  const token = useProfileStore((state) => state.token);
  const { eventBus } = useRealtimeSocket(!!token);
  // Push (#882): подписка устройства и «на экране ли приложение» — серверу.
  usePushNotifications(!!token);
  const pushOn = usePushStore((state) => state.status === 'on');

  useEffect(() => {
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!container) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (!isNavigateRequest(event.data)) return;
      // Роутер слушает popstate: новый адрес в истории + событие — переход
      // внутри приложения, без перезагрузки и без ссылки на сам роутер.
      window.history.pushState(null, '', event.data.url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };
    container.addEventListener('message', onMessage);
    return () => container.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    return eventBus.on('new_message', (payload) => {
      if (!document.hidden) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      // Push на этом устройстве включён — уведомление покажет service
      // worker; второе из вкладки было бы дублем.
      if (pushOn) return;

      const message = payload?.message ?? payload ?? {};
      const chatId = message.chatId ?? payload?.chatId;
      const title = message.senderName || 'CraneApp';

      void resolveNotificationBody(chatId, message).then((body) => {
        // Пока шла расшифровка, пользователь мог вернуться во вкладку.
        if (!document.hidden) return;

        try {
          new Notification(title, {
            body,
            icon: '/icons/icon-192.png',
            tag: chatId,
          });
        } catch (_) {}
      });
    });
  }, [eventBus, pushOn]);

  return null;
}
