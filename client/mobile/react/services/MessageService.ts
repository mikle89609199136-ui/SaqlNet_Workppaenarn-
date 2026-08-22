import { API_ENDPOINTS, ApiClient } from '@/api';
import { STORAGE_KEYS, WS_EVENTS } from '@/consts';
import { eventBus, getRawChat } from '@/core';
import { useChatStore } from '@/store';
import type {
  IChatContext,
  IDeleteMessageResponse,
  IEmojisResponse,
  IEncryptedMedia,
  ILastMessageDto,
  IMediaItem,
  IMessageDto,
  IMessageResponse,
  IMessagesResponse,
  IPinnedDto,
  IPinnedListResponse,
  IPinnedMessageDto,
  IReactionsResponse,
  ISuccessResponse,
  TMediaMessageType,
  TMessagesList,
  TMessageType,
  TPinnedList,
} from '@/types';
import { sortMessagesChronologically } from '@/utils';
import type { CryptoService } from './CryptoService';

const MEDIA_MESSAGE_TYPES = new Set(['image', 'video', 'audio', 'voice', 'file', 'gif', 'sticker']);
const LEGACY_MEDIA_UNAVAILABLE = 'Медиа недоступно: файл не зашифрован';

export class MessageService {
  private apiClient: ApiClient;
  private cryptoService: CryptoService;
  private messages: Map<string, TMessagesList>;
  private pinnedMessages: Map<string, TPinnedList>;

  constructor(apiClient: ApiClient, cryptoService: CryptoService) {
    this.apiClient = apiClient;
    this.cryptoService = cryptoService;
    this.messages = new Map();
    this.pinnedMessages = new Map();
  }

  async getMessages(
    chatId: string,
    offset: number = 0,
    limit: number = 50
  ): Promise<TMessagesList> {
    const cached = this.messages.get(chatId);
    if (cached && offset === 0) {
      return cached;
    }

    const response = await this.apiClient.get<IMessagesResponse>(API_ENDPOINTS.MESSAGES(chatId), {
      limit,
      offset,
    });

    const chatContext = await this.getChatContext(chatId, 'decryption');
    const messages = response.data.messages
      ? sortMessagesChronologically<IMessageDto>(
          await Promise.all(
            response.data.messages.map(async (item: IMessageDto) => {
              return this.processMessageForDisplay(chatId, item, chatContext);
            })
          )
        )
      : [];

    if (offset === 0) {
      this.messages.set(chatId, messages);
    }

    if (offset > 0 && cached) {
      this.messages.set(chatId, sortMessagesChronologically<IMessageDto>([...cached, ...messages]));
    }

    return messages;
  }

  getMeId(): string | null {
    try {
      const user = localStorage.getItem(STORAGE_KEYS.USER);
      if (!user) return null;
      const u = JSON.parse(user);
      return u?.id;
    } catch {
      return null;
    }
  }

  async sendMessage(
    chatId: string,
    content: string,
    type: TMessageType = 'text',
    replyTo: string | null = null
  ): Promise<IMessageDto> {
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Message must be a string');
    }

    const chatContext = await this.getChatContext(chatId, 'encryption');

    let encryptedContent = content.trim();
    if (type === 'text') {
      encryptedContent = await this.encryptContent(chatId, encryptedContent, chatContext);
    }

    const response = await this.apiClient.post<IMessageResponse>(
      API_ENDPOINTS.MESSAGE_SEND(chatId),
      {
        content: encryptedContent,
        type,
        replyTo,
      }
    );

    const messageObj = response.data.message;
    const message: IMessageDto = { ...messageObj, content: content.trim() };

    this.addMessageToCache(chatId, message);
    eventBus.emit(WS_EVENTS.MESSAGE.LOCAL.SENT, { message, chatId, type: WS_EVENTS.MESSAGE.NEW });

    return message;
  }

  async sendMediaMessage(
    chatId: string,
    media: Blob,
    mediaType: TMediaMessageType,
    caption: string = '',
    replyTo: string | null = null
  ): Promise<IMediaItem> {
    if (!MEDIA_MESSAGE_TYPES.has(mediaType)) {
      throw new Error(`Unsupported media message type: ${mediaType}`);
    }

    const chatContext = await this.getChatContext(chatId, 'media encryption');
    const encryptedMedia = await this.cryptoService.encryptMedia(chatId, media, chatContext);
    const uploadResponse = await this.apiClient.post(API_ENDPOINTS.MEDIA_UPLOAD, {
      file: encryptedMedia,
      type: mediaType,
      purpose: 'message',
    });

    const trimmedCaption = (caption || '').trim();
    const encryptedCaption = trimmedCaption
      ? await this.encryptContent(chatId, trimmedCaption, chatContext)
      : '';
    // Never copy the upload response wholesale into message metadata. Some
    // deployments return the ciphertext inside `encryption`, which makes the
    // subsequent /messages request as large as the file and trips the chat
    // service JSON limit. The media service already stores the ciphertext.
    const mediaEncryption = this.mediaMetadataFromPayload(encryptedMedia);

    const response = await this.apiClient.post<IMessageResponse>(
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
      }
    );

    const messageObj = response.data?.message ?? response.data;
    const localUrl =
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(
            await this.cryptoService.decryptMedia(chatId, encryptedMedia, chatContext)
          )
        : uploadResponse.data?.url;
    const message = {
      ...messageObj,
      content: trimmedCaption,
      mediaUrl: localUrl,
      mediaEncrypted: true,
      mediaEncryption,
    };

    this.addMessageToCache(chatId, message);
    return message;
  }

  async processMessageForDisplay(
    chatId: string,
    item: IMessageDto,
    chatContext: IChatContext | null = null
  ) {
    const context = chatContext || (await this.getChatContext(chatId, 'display'));
    let content = item.content;

    if (content) {
      content = await this.decryptContent(chatId, content, context, item.senderId);
    }

    const mediaPatch = await this.resolveMediaForDisplay(chatId, item, context);
    return { ...item, content, ...mediaPatch };
  }

  async processPinnedMessageForDisplay(
    chatId: string,
    message: IPinnedDto,
    chatContext: IChatContext | null = null
  ): Promise<IPinnedDto> {
    const context = chatContext || (await this.getChatContext(chatId, 'display'));

    let content = message.message.content;
    if (content) {
      content = await this.decryptContent(chatId, content, context, message.message.senderId);
    }

    const mediaPatch = await this.resolveMediaForDisplay(chatId, message.message, context);

    return {
      ...message,
      message: { ...message.message, content, ...mediaPatch },
    };
  }

  async processLastMessageForDisplay(
    chatId: string,
    message: ILastMessageDto,
    chatContext: IChatContext | null = null
  ): Promise<ILastMessageDto> {
    const context = chatContext || (await this.getChatContext(chatId, 'display'));

    let content = message.content;
    if (content) {
      content = await this.decryptContent(chatId, content, context, message.senderId);
    }

    return { ...message, content };
  }

  async getChatContext(chatId: string, purpose: string): Promise<IChatContext> {
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

  async encryptContent(chatId: string, content: string, chatContext: IChatContext) {
    if (!content) return content;
    if (chatContext.type === 'group') {
      return this.cryptoService.encryptGroup(chatId, content);
    }
    return this.cryptoService.encryptDM(content, chatContext.peerPublicKey!);
  }

  async decryptContent(
    chatId: string,
    content: string,
    chatContext: IChatContext,
    senderId: string | null = null
  ) {
    if (!content) return content;
    if (chatContext.type === 'group') {
      return this.cryptoService.decryptGroup(chatId, content);
    }
    const isOwnMessage = senderId && senderId === this.getMeId();
    return this.cryptoService.decryptDM(content, chatContext.peerPublicKey!, {
      preferEmbeddedSenderKey: !isOwnMessage,
    });
  }

  async resolveMediaForDisplay(chatId: string, item: IMessageDto, chatContext: IChatContext) {
    const metadata = item.metadata;

    if (!metadata || !('mediaUrl' in metadata)) {
      return {};
    }
    const mediaUrl = metadata.mediaUrl;
    if (!mediaUrl) return {};

    const mediaEncrypted = metadata.mediaEncrypted ?? false;
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
      const response = await this.apiClient.get<IEncryptedMedia>(mediaUrl);
      const encryptedPayload = response.data;
      const blob = await this.cryptoService.decryptMedia(chatId, encryptedPayload, chatContext);
      const objectUrl =
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(blob)
          : mediaUrl;

      return {
        mediaUrl: objectUrl,
        mediaOriginalUrl: mediaUrl,
        mediaEncrypted: true,
        mediaEncryption: metadata.mediaEncryption ?? null,
        mediaUnavailable: false,
      };
    } catch (error) {
      console.warn('Encrypted media decrypt failed:', error);
      return {
        mediaUrl: null,
        mediaOriginalUrl: mediaUrl,
        mediaEncrypted: true,
        mediaEncryption: metadata.mediaEncryption ?? null,
        mediaUnavailable: true,
        mediaUnavailableReason: 'Медиа недоступно: ошибка расшифровки',
      };
    }
  }

  mediaMetadataFromPayload(payload: IEncryptedMedia): Omit<IEncryptedMedia, 'ciphertext'> {
    const { ciphertext, ...metadata } = payload;
    return metadata;
  }

  async editMessage(messageId: string, chatId: string, content: string) {
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Message must be a string');
    }

    const response = await this.apiClient.put<IMessageDto>(API_ENDPOINTS.MESSAGE_BY_ID(messageId), {
      content: content.trim(),
    });
    const message = response.data;
    this.updatePinnedMessageInCache(messageId, message);
    this.updateMessageInCache(messageId, message);
    eventBus.emit(WS_EVENTS.MESSAGE.LOCAL.EDITED, {
      chatId: chatId,
      messageId,
      type: WS_EVENTS.MESSAGE.EDITED,
      updatedAt: new Date(),
      content: message.content,
    });

    return message;
  }

  async deleteMessage(chatId: string, messageId: string) {
    const response = await this.apiClient.delete<IDeleteMessageResponse>(API_ENDPOINTS.MESSAGE_BY_ID(messageId));
    this.removeMessageFromCache(messageId);
    eventBus.emit(WS_EVENTS.MESSAGE.LOCAL.DELETED, {
      messageId: messageId,
      previousMessage: response.data.lastMessage,
      chatId: chatId,
      type: WS_EVENTS.MESSAGE.DELETED,
    });
    return response.data;
  }

  async markAsRead(chatId: string, messageIds: string[]) {
    const response = await this.apiClient.post(API_ENDPOINTS.MESSAGE_READ, {
      chatId,
      messageIds,
    });

    this.messages.get(chatId)?.forEach((message) => {
      if (messageIds.includes(message.id)) {
        useChatStore.getState().markAsRead(message.id);
      }
    });

    eventBus.emit(WS_EVENTS.MESSAGE.LOCAL.READ, { chatId });
    return response.data;
  }

  async forwardMessage(messageId: string, targetChatId: string) {
    const response = await this.apiClient.post<IMessageResponse>(
      API_ENDPOINTS.MESSAGE_FORWARD(messageId),
      { targetChatId }
    );

    const processedMessage = await this.processMessageForDisplay(targetChatId, response.data.message);;
    const message = sortMessagesChronologically<IMessageDto>(
      await Promise.all(
        [processedMessage].map(async (item: IMessageDto) => {
          return this.processMessageForDisplay(targetChatId, item);
        })
      )
    )[0];

    this.addMessageToCache(targetChatId, message);

    return message;
  }

  async listReactions(messageId: string) {
    return this.apiClient
      .get<IReactionsResponse>(API_ENDPOINTS.MESSAGE_REACTIONS(messageId))
      .then((response) => response.data?.reactions ?? []);
  }

  async listPins(chatId: string) {
    const cached = this.pinnedMessages.get(chatId);
    if (cached) {
      return cached;
    }

    const response = await this.apiClient
      .get<IPinnedListResponse>(API_ENDPOINTS.CHAT_PINS(chatId))
      .then((response) => response.data?.pins ?? []);

    const chatContext = await this.getChatContext(chatId, 'decryption');

    const messages = sortMessagesChronologically<IPinnedDto>(
      await Promise.all(
        response.map(async (item: IPinnedDto) => {
          return {
            ...item,
            message: await this.processMessageForDisplay(chatId, item.message, chatContext),
          };
        })
      )
    );

    this.pinnedMessages.set(chatId, messages);
    return messages;
  }

  async pinMessage(chatId: string, messageId: string) {
    const response = await this.apiClient.post<ISuccessResponse>(
      API_ENDPOINTS.CHAT_PIN_MESSAGE(chatId, messageId)
    );

    return response.data;
  }

  async unpinMessage(chatId: string, messageId: string) {
    const response = await this.apiClient.delete(API_ENDPOINTS.CHAT_PIN_MESSAGE(chatId, messageId));

    this.removePinnedMessageFromCache(chatId);
    return response.data;
  }

  async reactToMessage(messageId: string, emoji: string): Promise<IEmojisResponse> {
    return this.apiClient
      .post<IEmojisResponse>(API_ENDPOINTS.MESSAGE_REACT(messageId), { emoji })
      .then((response) => response.data);
  }

  updateMessageInCache(messageId: string, patch: Partial<Omit<IMessageDto, 'id'>>) {
    this.messages.forEach((messages, chatId) => {
      this.messages.set(
        chatId,
        messages.map((message) => (message.id === messageId ? { ...message, ...patch } : message))
      );
    });
  }

  updatePinnedMessageInCache(messageId: string, patch: Partial<Omit<IPinnedMessageDto, 'id'>>) {
    this.pinnedMessages.forEach((pinnedMessages, chatId) => {
      this.pinnedMessages.set(
        chatId,
        pinnedMessages.map((pinned) =>
          pinned.messageId === messageId
            ? { ...pinned, message: { ...pinned.message, ...patch } }
            : pinned
        )
      );
    });
  }

  addPinnedMessageToCache(chatId: string, message: IPinnedDto) {
    if (!this.pinnedMessages.has(chatId)) {
      this.pinnedMessages.set(chatId, []);
    }
    this.pinnedMessages.set(
      chatId,
      sortMessagesChronologically<IPinnedDto>([...this.getOrCreatePinnedMessages(chatId), message])
    );
  }

  removePinnedMessageFromCache(messageId: string) {
    this.pinnedMessages.forEach((messages, chatId) => {
      this.pinnedMessages.set(
        chatId,
        messages.filter((message) => message.id !== messageId)
      );
    });
  }

  addMessageToCache(chatId: string, message: IMessageDto) {
    if (!this.messages.has(chatId)) {
      this.messages.set(chatId, []);
    }
    this.messages.set(
      chatId,
      sortMessagesChronologically<IMessageDto>([...this.getOrCreateMessages(chatId), message])
    );
  }

  removeMessageFromCache(messageId: string) {
    this.messages.forEach((messages, chatId) => {
      this.messages.set(
        chatId,
        messages.filter((message) => message.id !== messageId)
      );
    });
  }

  private getOrCreateMessages(chatId: string): TMessagesList {
    if (!this.messages.has(chatId)) {
      this.messages.set(chatId, []);
    }
    return this.messages.get(chatId)!;
  }

  private getOrCreatePinnedMessages(chatId: string): TPinnedList {
    if (!this.pinnedMessages.has(chatId)) {
      this.pinnedMessages.set(chatId, []);
    }
    return this.pinnedMessages.get(chatId)!;
  }
}
