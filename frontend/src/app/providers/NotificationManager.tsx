import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { services } from '@/services/serviceContainer';
import { useRealtimeSocket } from '@/shared/api';
import { decryptChatLastMessagePreview } from '@/services/decryptChatPreview';
import { useProfileStore } from '@/entities/user';
import { usePushNotifications, usePushStore } from '@/features/push-notifications';
import type { ILastMessageDto } from '@/types';
import { formatCallPreview } from '@/shared/lib';
import { useEffect } from 'react';

/* На языке интерфейса в момент уведомления, а не при загрузке модуля. */
const fallbackBody = (t: TFunction) => t('notification.newMessage', 'Новое сообщение');
const MAX_BODY_LENGTH = 120;

/**
 * Готовит текст уведомления.
 *
 * Содержимое сообщения приходит зашифрованным, поэтому его нужно провести
 * через ту же расшифровку, что и превью в списке чатов. Уведомление —
 * единственное место, где текст покидает вкладку и попадает в систему:
 * сюда не должен просочиться ни шифртекст, ни служебный плейсхолдер.
 */
async function resolveNotificationBody(
  chatId: string,
  message: ILastMessageDto,
  t: TFunction,
  viewerId: string
): Promise<string> {
  // Read the server preference even if another device changed it.
  // If the request fails, keep message text out of the system notification.
  try {
    const chat = await services.chatService.getChat(chatId);
    if (chat.hideNotificationPreview) return fallbackBody(t);
  } catch {
    return fallbackBody(t);
  }

  if (typeof message?.content !== 'string' || !message.content) return fallbackBody(t);

  // Звонок не зашифрован; подпись — на языке интерфейса, с итогом (#1073).
  if (message.type === 'call') {
    return formatCallPreview(message.content, t, { senderId: message.senderId, viewerId });
  }

  try {
    const decrypted = await decryptChatLastMessagePreview(chatId, message);
    const text = decrypted?.content;

    if (typeof text !== 'string' || !text) return fallbackBody(t);
    // Расшифровать не удалось: сервис возвращает исходный payload либо
    // заглушку с причиной. В уведомлении не место ни тому, ни другому.
    if (decrypted?.undecryptable) return fallbackBody(t);
    if (text.startsWith('{')) return fallbackBody(t);

    // Пока шла расшифровка (в том числе загрузка ключей), другое
    // устройство могло включить скрытие. Проверяем перед выдачей текста;
    // ошибка повторного запроса тоже приводит к безопасной заглушке.
    const chat = await services.chatService.getChat(chatId);
    if (chat.hideNotificationPreview) return fallbackBody(t);

    return text.slice(0, MAX_BODY_LENGTH);
  } catch {
    return fallbackBody(t);
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
  const { t } = useTranslation();
  const signedIn = useProfileStore((state) => state.isAuth);
  const { eventBus } = useRealtimeSocket(signedIn);
  // Push (#882): подписка устройства и «на экране ли приложение» — серверу.
  usePushNotifications(signedIn);
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

      const message = (payload?.message ?? payload ?? {}) as ILastMessageDto & {
        chatId?: string;
      };
      const chatId = message.chatId ?? payload?.chatId;
      if (typeof chatId !== 'string' || !chatId) return;
      const title = message.senderName || 'CraneApp';

      const userId = useProfileStore.getState().user?.id ?? '';
      void resolveNotificationBody(chatId, message, t, userId).then((body) => {
        // Пока шла расшифровка, пользователь мог вернуться во вкладку.
        if (!document.hidden) return;
        const profile = useProfileStore.getState();
        if (!profile.isAuth || (profile.user?.id ?? '') !== userId) return;

        try {
          new Notification(title, {
            body,
            icon: '/icons/icon-192.png',
            tag: chatId,
          });
        } catch (_) {}
      });
    });
  }, [eventBus, pushOn, t]);

  return null;
}
