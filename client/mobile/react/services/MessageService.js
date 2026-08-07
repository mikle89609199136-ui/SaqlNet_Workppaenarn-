import Message from "../../domain/entities/Message.js";
import MessageValidator from "../../domain/validators/MessageValidator.js";
import API_ENDPOINTS from "../../infrastructure/api/endpoints.js";
import { sortMessagesChronologically } from "../../utils/sortMessagesChronologically.js";
import { getRawChat } from "../core/chatCache.js";
import { eventBus } from "../core/EventBus.js";

const MEDIA_MESSAGE_TYPES = new Set([
  "image",
  "video",
  "audio",
  "voice",
  "file",
  "gif",
  "sticker",
]);
const LEGACY_MEDIA_UNAVAILABLE = "Медиа недоступно: файл не зашифрован";

class MessageService {
  constructor(apiClient, cryptoService) {
    this.apiClient = apiClient;
    this.cryptoService = cryptoService;
    this.messages = new Map();
    this.pinnedMessages = new Map();
  }

  async getMessages(chatId, offset = 0, limit = 50) {
    const cached = this.messages.get(chatId);
    if (cached && offset === 0) {
      return cached;
    }

    const response = await this.apiClient.get(API_ENDPOINTS.MESSAGES(chatId), {
      limit,
      offset,
    });

    const chatContext = await this.getChatContext(chatId, "decryption");
    const messages = sortMessagesChronologically(
      await Promise.all(
        this.normalizeList(response.data).map(async (item) => {
          return this.processMessageForDisplay(chatId, item, chatContext);
        }),
      ),
    );

    if (offset === 0) {
      this.messages.set(chatId, messages);
    }

    if (offset > 0 && cached) {
      this.messages.set(
        chatId,
        sortMessagesChronologically([...cached, ...messages]),
      );
    }

    return messages;
  }

  getMeId() {
    try {
      const u = JSON.parse(localStorage.getItem("craneapp_user_data"));
      return u?.id;
    } catch {
      return null;
    }
  }

  async sendMessage(chatId, content, type = "text", replyTo = null) {
    const validation = MessageValidator.validateContent(content);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const chatContext = await this.getChatContext(chatId, "encryption");

    let encryptedContent = content.trim();
    if (type === "text") {
      encryptedContent = await this.encryptContent(
        chatId,
        encryptedContent,
        chatContext,
      );
    }

    const response = await this.apiClient.post(
      API_ENDPOINTS.MESSAGE_SEND(chatId),
      {
        content: encryptedContent,
        type,
        replyTo,
      },
    );

    // We want the local message to show the original content, not the encrypted payload
    const messageObj = response.data?.message ?? response.data;
    const message = Message.fromAPI({ ...messageObj, content: content.trim() });

    this.addMessageToCache(chatId, message);
    eventBus.emit("message:sent", message);

    return message;
  }

  async sendMediaMessage(
    chatId,
    media,
    mediaType,
    caption = "",
    replyTo = null,
  ) {
    if (!MEDIA_MESSAGE_TYPES.has(mediaType)) {
      throw new Error(`Unsupported media message type: ${mediaType}`);
    }

    const chatContext = await this.getChatContext(chatId, "media encryption");
    const encryptedMedia = await this.cryptoService.encryptMedia(
      chatId,
      media,
      chatContext,
    );
    const uploadResponse = await this.apiClient.post(
      API_ENDPOINTS.MEDIA_UPLOAD,
      {
        file: encryptedMedia,
        type: mediaType,
        purpose: "message",
      },
    );

    const trimmedCaption = (caption || "").trim();
    const encryptedCaption = trimmedCaption
      ? await this.encryptContent(chatId, trimmedCaption, chatContext)
      : "";
    // Never copy the upload response wholesale into message metadata. Some
    // deployments return the ciphertext inside `encryption`, which makes the
    // subsequent /messages request as large as the file and trips the chat
    // service JSON limit. The media service already stores the ciphertext.
    const mediaEncryption = this.mediaMetadataFromPayload(encryptedMedia);

    const response = await this.apiClient.post(
      API_ENDPOINTS.MESSAGE_SEND(chatId),
      {
        content: encryptedCaption,
        type: mediaType,
        replyTo,
        mediaUrl: uploadResponse.data?.url,
        mediaType,
        mediaEncrypted: true,
        mediaEncryption,
        isEncrypted: Boolean(trimmedCaption),
      },
    );

    const messageObj = response.data?.message ?? response.data;
    const localUrl =
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(
            await this.cryptoService.decryptMedia(
              chatId,
              encryptedMedia,
              chatContext,
            ),
          )
        : uploadResponse.data?.url;
    const message = Message.fromAPI({
      ...messageObj,
      content: trimmedCaption,
      mediaUrl: localUrl,
      mediaEncrypted: true,
      mediaEncryption,
    });

    this.addMessageToCache(chatId, message);
    eventBus.emit("message:sent", message);

    return message;
  }

  async processMessageForDisplay(chatId, item, chatContext = null) {
    const context =
      chatContext || (await this.getChatContext(chatId, "display"));
    const normalizedItem = { ...item.metadata, ...item };
    const type =
      normalizedItem.type ||
      normalizedItem.mediaType ||
      normalizedItem.media_type ||
      "text";
    let content = item.content;

    if (content) {
      content = await this.decryptContent(
        chatId,
        content,
        context,
        item.senderId ?? item.sender_id,
      );
    }

    const mediaPatch = await this.resolveMediaForDisplay(
      chatId,
      { ...normalizedItem, type },
      context,
    );
    return Message.fromAPI({ ...normalizedItem, type, content, ...mediaPatch });
  }

  async getChatContext(chatId, purpose) {
    try {
      const chat = await getRawChat(this.apiClient, chatId);

      return {
        ...(chat || {}),
        type: chat?.type || 'private',
        peerPublicKey: chat?.peerPublicKey || null,
      };
    } catch (e) {
      console.warn(`Failed to fetch chat info for ${purpose} context`, e);
      return { type: 'private', peerPublicKey: null };
    }
  }

  async encryptContent(chatId, content, chatContext) {
    if (!content) return content;
    if (chatContext.type === "group") {
      return this.cryptoService.encryptGroup(chatId, content);
    }
    return this.cryptoService.encryptDM(content, chatContext.peerPublicKey);
  }

  async decryptContent(chatId, content, chatContext, senderId = null) {
    if (!content) return content;
    if (chatContext.type === "group") {
      return this.cryptoService.decryptGroup(chatId, content);
    }
    const isOwnMessage = senderId && senderId === this.getMeId();
    return this.cryptoService.decryptDM(content, chatContext.peerPublicKey, {
      preferEmbeddedSenderKey: !isOwnMessage,
    });
  }

  async resolveMediaForDisplay(chatId, item, chatContext) {
    const mediaUrl = item.mediaUrl ?? item.media_url ?? null;
    if (!mediaUrl) return {};

    const mediaEncrypted = item.mediaEncrypted ?? item.media_encrypted ?? false;
    if (!mediaEncrypted) {
      if (!MEDIA_MESSAGE_TYPES.has(item.type)) return {};
      return {
        mediaUrl: null,
        mediaEncrypted: false,
        mediaUnavailable: true,
        mediaUnavailableReason: LEGACY_MEDIA_UNAVAILABLE,
      };
    }

    try {
      const response = await this.apiClient.get(mediaUrl);
      const encryptedPayload = response.data;
      const blob = await this.cryptoService.decryptMedia(
        chatId,
        encryptedPayload,
        chatContext,
      );
      const objectUrl =
        typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(blob)
          : mediaUrl;

      return {
        mediaUrl: objectUrl,
        mediaOriginalUrl: mediaUrl,
        mediaEncrypted: true,
        mediaEncryption: item.mediaEncryption ?? item.media_encryption ?? null,
        mediaUnavailable: false,
      };
    } catch (error) {
      console.warn("Encrypted media decrypt failed:", error);
      return {
        mediaUrl: null,
        mediaOriginalUrl: mediaUrl,
        mediaEncrypted: true,
        mediaEncryption: item.mediaEncryption ?? item.media_encryption ?? null,
        mediaUnavailable: true,
        mediaUnavailableReason: "Медиа недоступно: ошибка расшифровки",
      };
    }
  }

  mediaMetadataFromPayload(payload) {
    const { ciphertext, ...metadata } = payload;
    return metadata;
  }

  async editMessage(messageId, content) {
    const validation = MessageValidator.validateContent(content);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const response = await this.apiClient.put(
      API_ENDPOINTS.MESSAGE_BY_ID(messageId),
      {
        content: content.trim(),
      },
    );
    const message = response.data;
    this.updatePinnedMessageInCache(messageId, message);
    this.updateMessageInCache(messageId, message);
    eventBus.emit("message:edited", message);

    return message;
  }

  async deleteMessage(messageId) {
    const response = await this.apiClient.delete(
      API_ENDPOINTS.MESSAGE_BY_ID(messageId),
    );
    this.removeMessageFromCache(messageId);
    eventBus.emit("message:deleted", { messageId });
    return response.data;
  }

  async markAsRead(chatId, messageIds) {
    const response = await this.apiClient.post(API_ENDPOINTS.MESSAGE_READ, {
      chatId,
      messageIds,
    });

    this.messages.get(chatId)?.forEach((message) => {
      if (messageIds.includes(message.id)) {
        message.markAsRead();
      }
    });

    eventBus.emit("messages:read", { chatId, messageIds });
    return response.data;
  }

  async forwardMessage(messageId, targetChatId) {
    const response = await this.apiClient.post(
      API_ENDPOINTS.MESSAGE_FORWARD(messageId),
      { targetChatId },
    );

    const message = sortMessagesChronologically(
      await Promise.all(
        this.normalizeList([response.data.message]).map(async (item) => {
          return this.processMessageForDisplay(targetChatId, item);
        }),
      ),
    )[0];

    this.addMessageToCache(targetChatId, message);
    eventBus.emit("message:sent", { message, chatId: targetChatId });

    return message;
  }

  listReactions(messageId) {
    return this.apiClient
      .get(API_ENDPOINTS.MESSAGE_REACTIONS(messageId))
      .then((response) => response.data?.reactions ?? []);
  }

  async listPins(chatId) {
    const cached = this.pinnedMessages.get(chatId);
    if (cached) {
      return cached;
    }

    const response = await this.apiClient
      .get(API_ENDPOINTS.CHAT_PINS(chatId))
      .then((response) => response.data?.pins ?? []);

    const chatContext = await this.getChatContext(chatId, "decryption");

    const messages = sortMessagesChronologically(
      await Promise.all(
        this.normalizeList(response).map(async (item) => {
          return {
            ...item,
            message: await this.processMessageForDisplay(
              chatId,
              item.message,
              chatContext,
            ),
          };
        }),
      ),
    );

    this.pinnedMessages.set(chatId, messages);
    return messages;
  }

  async pinMessage(chatId, messageId) {
    const response = await this.apiClient.post(
      API_ENDPOINTS.CHAT_PIN_MESSAGE(chatId, messageId),
    );

    this.addPinnedMessageToCache(chatId, response.data);
    eventBus.emit("message:pin", { chatId, messageId });
    return response.data;
  }

  async unpinMessage(chatId, messageId) {
    const response = await this.apiClient.delete(
      API_ENDPOINTS.CHAT_PIN_MESSAGE(chatId, messageId),
    );

    this.removePinnedMessageFromCache(chatId);
    eventBus.emit("message:unpin", { chatId, messageId });
    return response.data;
  }

  reactToMessage(messageId, emoji) {
    return this.apiClient
      .post(API_ENDPOINTS.MESSAGE_REACT(messageId), { emoji })
      .then((response) => response.data);
  }

  updateMessageInCache(messageId, patch) {
    this.messages.forEach((messages, chatId) => {
      this.messages.set(
        chatId,
        messages.map((message) =>
          message.id === messageId ? { ...message, ...patch } : message,
        ),
      );
    });
  }

  updatePinnedMessageInCache(messageId, patch) {
    this.pinnedMessages.forEach((pinnedMessages, chatId) => {
      this.pinnedMessages.set(
        chatId,
        pinnedMessages.map((pinned) =>
          pinned.messageId === messageId
            ? { ...pinned, message: { ...pinned.message, ...patch } }
            : pinned,
        ),
      );
    });
  }

  addPinnedMessageToCache(chatId, message) {
    if (!this.pinnedMessages.has(chatId)) {
      this.pinnedMessages.set(chatId, []);
    }
    this.pinnedMessages.set(
      chatId,
      sortMessagesChronologically([
        ...this.pinnedMessages.get(chatId),
        message,
      ]),
    );
  }

  removePinnedMessageFromCache(messageId) {
    this.pinnedMessages.forEach((messages, chatId) => {
      this.pinnedMessages.set(
        chatId,
        messages.filter((message) => message.id !== messageId),
      );
    });
  }

  addMessageToCache(chatId, message) {
    if (!this.messages.has(chatId)) {
      this.messages.set(chatId, []);
    }
    this.messages.set(
      chatId,
      sortMessagesChronologically([...this.messages.get(chatId), message]),
    );
  }

  removeMessageFromCache(messageId) {
    this.messages.forEach((messages, chatId) => {
      this.messages.set(
        chatId,
        messages.filter((message) => message.id !== messageId),
      );
    });
  }

  normalizeList(data) {
    if (Array.isArray(data)) return data;
    return data?.messages ?? data?.items ?? [];
  }
}

export default MessageService;
