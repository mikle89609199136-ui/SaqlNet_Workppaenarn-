import { API_ENDPOINTS } from '@/api/endpoints';
import type { ApiClient } from '@/api/ApiClient';
import type { IChatResponse, TChat } from '@/types';

const cache = new Map<string, { promise: Promise<TChat>; expiresAt: number }>(); // chatId -> { promise, expiresAt }
const TTL_MS = 5000;

export async function getRawChat(apiClient: ApiClient, chatId: string): Promise<TChat> {
  const cached = cache.get(chatId);

  if (cached && cached.expiresAt > Date.now()) {
    try {
      const chat = await cached.promise;

      if (chat && (chat.type === 'group' || ('peerPublicKey' in chat && chat.peerPublicKey))) {
        return chat;
      }

      invalidateChat(chatId);
    } catch {
      invalidateChat(chatId);
    }
  }

  const promise = apiClient
    .get<IChatResponse>(API_ENDPOINTS.CHAT_BY_ID(chatId))
    .then((response) => {
      const chat = response.data.chat;

      if (!chat) {
        throw new Error('Empty chat response');
      }

      return chat;
    })
    .catch((error) => {
      invalidateChat(chatId);
      throw error;
    });

  cache.set(chatId, {
    promise,
    expiresAt: Date.now() + TTL_MS,
  });

  const chat = await promise;

  if (chat.type !== 'group' && !('peerPublicKey' in chat)) {
    invalidateChat(chatId);
  }

  return chat;
}

export function invalidateChat(chatId: string) {
  cache.delete(chatId);
}

/**
 * Полный сброс. Кеш живёт на уровне модуля, поэтому между тестами в нём
 * остаются промисы предыдущего сценария — вплоть до тех, что уже никогда
 * не завершатся.
 */
export function clearChatCache() {
  cache.clear();
}
