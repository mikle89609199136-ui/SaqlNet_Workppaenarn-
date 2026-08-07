import API_ENDPOINTS from "../../infrastructure/api/endpoints";

const cache = new Map(); // chatId -> { promise, expiresAt }
const TTL_MS = 5000;

export async function getRawChat(apiClient, chatId) {
  const cached = cache.get(chatId);

  if (cached && cached.expiresAt > Date.now()) {
    try {
      const chat = await cached.promise;

      if (chat && (chat.type === "group" || chat.peerPublicKey)) {
        return chat;
      }

      invalidateChat(chatId);
    } catch (e) {
      invalidateChat(chatId);
    }
  }

  const promise = apiClient
    .get(API_ENDPOINTS.CHAT_BY_ID(chatId))
    .then((response) => {
      const chat = response.data?.chat ?? response.data;

      if (!chat) {
        throw new Error("Empty chat response");
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

  if (chat.type !== "group" && !chat.peerPublicKey) {
    invalidateChat(chatId);
  }

  return chat;
}

export function invalidateChat(chatId) {
  cache.delete(chatId);
}