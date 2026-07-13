import { eventBus } from '../../core/EventBus.js';
import Message from '../../domain/entities/Message.js';
import MessageValidator from '../../domain/validators/MessageValidator.js';
import API_ENDPOINTS from '../../infrastructure/api/endpoints.js';

const MEDIA_MESSAGE_TYPES = new Set(['image', 'video', 'audio', 'voice', 'file', 'gif', 'sticker']);
const LEGACY_MEDIA_UNAVAILABLE = 'Медиа недоступно: файл не зашифрован';

class MessageService {
  constructor(apiClient, cryptoService) {
    this.apiClient = apiClient;
    this.cryptoService = cryptoService;
    this.messages = new Map();
  }

  async getMessages(chatId, limit = 50, offset = 0) {
    const cached = this.messages.get(chatId);
    if (cached && offset === 0) {
      return cached;
    }

    const response = await this.apiClient.get(API_ENDPOINTS.MESSAGES(chatId), {
      limit,
      offset,
    });
    
    const chatContext = await this.getChatContext(chatId, 'decryption');

    const messages = sortMessagesChronologically(await Promise.all(this.normalizeList(response.data).map(async (item) => {
      return this.processMessageForDisplay(chatId, item, chatContext);
    })));

    if (offset === 0) {
      this.messages.set(chatId, messages);
    }

    return messages;
  }
  
  getMeId() {
    try {
      const u = JSON.parse(localStorage.getItem('craneapp_user_data'));
      return u?.id;
    } catch { return null; }
  }

  async sendMessage(chatId, content, type = 'text', replyTo = null) {
    const validation = MessageValidator.validateContent(content);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const chatContext = await this.getChatContext(chatId, 'encryption');

    let encryptedContent = content.trim();
    if (type === 'text') {
      encryptedContent = await this.encryptContent(chatId, encryptedContent, chatContext);
    }

    const response = await this.apiClient.post(API_ENDPOINTS.MESSAGE_SEND(chatId), {
      content: encryptedContent,
      type,
      replyTo,
    });
    
    // We want the local message to show the original content, not the encrypted payload
    const messageObj = response.data?.message ?? response.data;
    const message = Message.fromAPI({ ...messageObj, content: content.trim() });

    this.addMessageToCache(chatId, message);
    eventBus.emit('message:sent', message);

    return message;
  }

  async sendMediaMessage(chatId, media, mediaType, caption = '', replyTo = null) {
    if (!MEDIA_MESSAGE_TYPES.has(mediaType)) {
      throw new Error(`Unsupported media message type: ${mediaType}`);
    }

    const chatContext = await this.getChatContext(chatId, 'media encryption');
    const encryptedMedia = await this.cryptoService.encryptMedia(chatId, media, chatContext);
    const uploadResponse = await this.apiClient.post('/upload', {
      file: encryptedMedia,
      type: mediaType,
      purpose: 'message',
    });

    const trimmedCaption = (caption || '').trim();
    const encryptedCaption = trimmedCaption
      ? await this.encryptContent(chatId, trimmedCaption, chatContext)
      : '';
    const mediaEncryption = uploadResponse.data?.encryption || this.mediaMetadataFromPayload(encryptedMedia);

    const response = await this.apiClient.post(API_ENDPOINTS.MESSAGE_SEND(chatId), {
      content: encryptedCaption,
      type: mediaType,
      replyTo,
      mediaUrl: uploadResponse.data?.url,
      mediaType,
      mediaEncrypted: true,
      mediaEncryption,
      isEncrypted: Boolean(trimmedCaption),
    });

    const messageObj = response.data?.message ?? response.data;
    const localUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(await this.cryptoService.decryptMedia(chatId, encryptedMedia, chatContext))
      : uploadResponse.data?.url;
    const message = Message.fromAPI({
      ...messageObj,
      content: trimmedCaption,
      mediaUrl: localUrl,
      mediaEncrypted: true,
      mediaEncryption,
    });

    this.addMessageToCache(chatId, message);
    eventBus.emit('message:sent', message);

    return message;
  }

  async processMessageForDisplay(chatId, item, chatContext = null) {
    const context = chatContext || await this.getChatContext(chatId, 'display');
    const type = item.type || item.mediaType || item.media_type || 'text';
    let content = item.content;

    if (content) {
      content = await this.decryptContent(chatId, content, context);
    }

    const mediaPatch = await this.resolveMediaForDisplay(chatId, { ...item, type }, context);
    return Message.fromAPI({ ...item, type, content, ...mediaPatch });
  }

  async getChatContext(chatId, purpose) {
    try {
      const chatRes = await this.apiClient.get(`/chats/${chatId}`);
      const chat = chatRes.data?.chat ?? chatRes.data;
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
    if (chatContext.type === 'group') {
      return this.cryptoService.encryptGroup(chatId, content);
    }
    return this.cryptoService.encryptDM(content, chatContext.peerPublicKey);
  }

  async decryptContent(chatId, content, chatContext) {
    if (!content) return content;
    if (chatContext.type === 'group') {
      return this.cryptoService.decryptGroup(chatId, content);
    }
    return this.cryptoService.decryptDM(content, chatContext.peerPublicKey);
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
      const blob = await this.cryptoService.decryptMedia(chatId, encryptedPayload, chatContext);
      const objectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
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
      console.warn('Encrypted media decrypt failed:', error);
      return {
        mediaUrl: null,
        mediaOriginalUrl: mediaUrl,
        mediaEncrypted: true,
        mediaEncryption: item.mediaEncryption ?? item.media_encryption ?? null,
        mediaUnavailable: true,
        mediaUnavailableReason: 'Медиа недоступно: ошибка расшифровки',
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

    const response = await this.apiClient.put(API_ENDPOINTS.MESSAGE_BY_ID(messageId), {
      content: content.trim(),
    });
    const message = {
      messageId,
      content: response.data?.content ?? content.trim(),
      editedAt: response.data?.editedAt ?? new Date(),
      success: response.data?.success ?? true,
    };
    this.updateMessageInCache(messageId, {
      content: message.content,
      editedAt: message.editedAt,
      isEdited: true,
    });
    eventBus.emit('message:edited', message);

    return message;
  }

  async deleteMessage(messageId) {
    const response = await this.apiClient.delete(API_ENDPOINTS.MESSAGE_BY_ID(messageId));
    this.removeMessageFromCache(messageId);
    eventBus.emit('message:deleted', { messageId });
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

    eventBus.emit('messages:read', { chatId, messageIds });
    return response.data;
  }

  forwardMessage(messageId, targetChatId) {
    return this.apiClient
      .post(API_ENDPOINTS.MESSAGE_FORWARD(messageId), { targetChatId })
      .then((response) => response.data);
  }

  listReactions(messageId) {
    return this.apiClient
      .get(API_ENDPOINTS.MESSAGE_REACTIONS(messageId))
      .then((response) => response.data?.reactions ?? []);
  }

  listPins(chatId) {
    return this.apiClient
      .get(API_ENDPOINTS.CHAT_PINS(chatId))
      .then((response) => response.data?.pins ?? []);
  }

  pinMessage(chatId, messageId) {
    return this.apiClient
      .post(API_ENDPOINTS.CHAT_PIN_MESSAGE(chatId, messageId))
      .then((response) => response.data);
  }

  unpinMessage(chatId, messageId) {
    return this.apiClient
      .delete(API_ENDPOINTS.CHAT_PIN_MESSAGE(chatId, messageId))
      .then((response) => response.data);
  }

  reactToMessage(messageId, emoji) {
    return this.apiClient
      .post(API_ENDPOINTS.MESSAGE_REACT(messageId), { emoji })
      .then((response) => response.data);
  }

  updateMessageInCache(messageId, patch) {
    this.messages.forEach((messages, chatId) => {
      this.messages.set(chatId, messages.map((message) => (
        message.id === messageId ? { ...message, ...patch } : message
      )));
    });
  }

  addMessageToCache(chatId, message) {
    if (!this.messages.has(chatId)) {
      this.messages.set(chatId, []);
    }
    this.messages.set(chatId, sortMessagesChronologically([...this.messages.get(chatId), message]));
  }

  removeMessageFromCache(messageId) {
    this.messages.forEach((messages, chatId) => {
      this.messages.set(chatId, messages.filter((message) => message.id !== messageId));
    });
  }

  normalizeList(data) {
    if (Array.isArray(data)) return data;
    return data?.messages ?? data?.items ?? [];
  }
}

function sortMessagesChronologically(messages) {
  return [...messages].sort((left, right) => messageTime(left) - messageTime(right));
}

function messageTime(message) {
  const value = message?.timestamp ?? message?.createdAt ?? message?.created_at;
  const time = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export default MessageService;
