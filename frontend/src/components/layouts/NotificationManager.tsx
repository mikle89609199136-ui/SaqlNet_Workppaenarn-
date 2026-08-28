import { useRealtimeSocket } from '@/hooks';
import { decryptChatLastMessagePreview } from '@/services/decryptChatPreview';
import { useProfileStore } from '@/store';
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
    // Расшифровать не удалось: сервис возвращает либо исходный payload,
    // либо пометку с замком. В уведомлении не место ни тому, ни другому.
    if (text.startsWith('{') || text.startsWith('🔒')) return FALLBACK_BODY;

    return text.slice(0, MAX_BODY_LENGTH);
  } catch {
    return FALLBACK_BODY;
  }
}

export function NotificationManager() {
  const token = useProfileStore((state) => state.token);
  const { eventBus } = useRealtimeSocket(!!token);

  useEffect(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    return eventBus.on('new_message', (payload) => {
      if (!document.hidden) return;
      if (Notification.permission !== 'granted') return;

      const message = payload?.message ?? payload ?? {};
      const chatId = message.chatId ?? payload?.chatId;
      const title = message.senderName || 'CraneApp';

      void resolveNotificationBody(chatId, message).then((body) => {
        // Пока шла расшифровка, пользователь мог вернуться во вкладку.
        if (!document.hidden) return;

        try {
          new Notification(title, {
            body,
            icon: '/favicon.ico',
            tag: chatId,
          });
        } catch (_) {}
      });
    });
  }, [eventBus]);

  return null;
}
