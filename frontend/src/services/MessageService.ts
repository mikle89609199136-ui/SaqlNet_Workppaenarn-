import { API_ENDPOINTS, ApiClient } from '@/shared/api';
import { resolveMediaObjectUrl } from '@/entities/media/model/mediaObjectUrls';
import { resolveChat } from '@/entities/chat/model/chatResolver';
import type { IChatContext, ILastMessageDto } from '@/entities/chat';
import type {
  IMediaItem,
  IMessageDto,
  IPinnedDto,
  TMediaMessageType,
  TMessagesList,
  TMessageType,
} from '@/entities/message';
import type {
  IDeleteMessageResponse,
  IEmojisResponse,
  IEncryptedMedia,
  IMessageResponse,
  IUploadResponse,
  IMessagesResponse,
  IPinnedListResponse,
  IReactionsResponse,
  ISuccessResponse,
} from '@/shared/types';
import { sortMessagesChronologically } from '@/shared/lib';
import type { CryptoService, IDecryptedMessage, TUndecryptableReason } from './CryptoService';

const MEDIA_MESSAGE_TYPES = new Set(['image', 'video', 'audio', 'voice', 'file', 'gif', 'sticker']);
const LEGACY_MEDIA_UNAVAILABLE = 'Медиа недоступно: файл не зашифрован';

export class MessageService {
  private apiClient: ApiClient;
  private cryptoService: CryptoService;
  constructor(apiClient: ApiClient, cryptoService: CryptoService) {
    this.apiClient = apiClient;
    this.cryptoService = cryptoService;
  }

  /**
   * Загружает страницу истории и расшифровывает её.
   *
   * В отличие от getMessages не заглядывает во внутренний кеш и не пишет
   * в него: свежестью данных распоряжается слой запросов. Этот метод
   * останется, когда внутренние Map будут удалены.
   */
  async fetchMessagesPage(
    chatId: string,
    offset: number = 0,
    limit: number = 50
  ): Promise<TMessagesList> {
    const response = await this.apiClient.get<IMessagesResponse>(API_ENDPOINTS.MESSAGES(chatId), {
      limit,
      offset,
    });

    if (!response.data.messages) return [];

    const chatContext = await this.getChatContext(chatId, 'decryption');

    return sortMessagesChronologically<IMessageDto>(
      await Promise.all(
        response.data.messages.map((item: IMessageDto) =>
          this.processMessageForDisplay(chatId, item, chatContext)
        )
      )
    );
  }

  async sendMessage(
    chatId: string,
    content: string,
    type: TMessageType = 'text',
    replyTo: string | null = null,
    forwardedFrom: string | null = null
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
        ...(forwardedFrom ? { forwardedFrom } : {}),
      }
    );

    const messageObj = response.data.message;
    const message: IMessageDto = { ...messageObj, content: content.trim() };

    return message;
  }

  async sendMediaMessage(
    chatId: string,
    media: Blob,
    mediaType: TMediaMessageType,
    caption: string = '',
    replyTo: string | null = null,
    forwardedFrom: string | null = null
  ): Promise<IMediaItem> {
    if (!MEDIA_MESSAGE_TYPES.has(mediaType)) {
      throw new Error(`Unsupported media message type: ${mediaType}`);
    }

    const chatContext = await this.getChatContext(chatId, 'media encryption');
    const encryptedMedia = await this.cryptoService.encryptMedia(chatId, media);
    const uploadResponse = await this.apiClient.post<IUploadResponse>(API_ENDPOINTS.MEDIA_UPLOAD, {
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
        ...(forwardedFrom ? { forwardedFrom } : {}),
      }
    );

    const messageObj = response.data?.message ?? response.data;
    const uploadedUrl = uploadResponse.data?.url;
    // Тот же реестр, что и при показе: когда лента перезапросится, для
    // этого файла вернётся уже готовый адрес, а не вторая копия.
    const canRegister =
      Boolean(uploadedUrl) &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function';
    const localUrl =
      canRegister && uploadedUrl
        ? await resolveMediaObjectUrl(uploadedUrl, () =>
            this.cryptoService.decryptMedia(chatId, encryptedMedia)
          )
        : uploadedUrl;
    const message = {
      ...messageObj,
      content: trimmedCaption,
      mediaUrl: localUrl,
      mediaEncrypted: true,
      mediaEncryption,
    };

    return message;
  }

  async processMessageForDisplay(
    chatId: string,
    item: IMessageDto,
    chatContext: IChatContext | null = null
  ) {
    const context = chatContext || (await this.getChatContext(chatId, 'display'));
    let content = item.content;
    let senderVerified: boolean | undefined;
    /* Причина, по которой сообщение не прочиталось, едет вместе с ним:
       подпись подставит тот, кто рисует, — он знает язык. */
    let undecryptable: TUndecryptableReason | undefined;

    if (content) {
      const decrypted = await this.decryptContent(chatId, content, context, item.senderId);
      content = decrypted.text;
      senderVerified = decrypted.senderVerified;
      undecryptable = decrypted.undecryptable;
    }

    const mediaPatch = await this.resolveMediaForDisplay(chatId, item);
    return { ...item, content, senderVerified, undecryptable, ...mediaPatch };
  }

  async processPinnedMessageForDisplay(
    chatId: string,
    message: IPinnedDto,
    chatContext: IChatContext | null = null
  ): Promise<IPinnedDto> {
    const context = chatContext || (await this.getChatContext(chatId, 'display'));

    let content = message.message.content;
    if (content) {
      content = (await this.decryptContent(chatId, content, context, message.message.senderId))
        .text;
    }

    const mediaPatch = await this.resolveMediaForDisplay(chatId, message.message);

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
    let undecryptable: TUndecryptableReason | undefined;

    if (content) {
      const decrypted = await this.decryptContent(chatId, content, context, message.senderId);
      content = decrypted.text;
      undecryptable = decrypted.undecryptable;
    }

    return { ...message, content, undecryptable };
  }

  /**
   * Тип чата — всё, что шифрованию нужно знать о чате.
   *
   * Ключей здесь больше нет: они не привязаны к собеседнику, а живут у
   * самого чата. Осталась одна развилка — каналы не шифруются.
   */
  async getChatContext(chatId: string, purpose: string): Promise<IChatContext> {
    try {
      const chat = await resolveChat(chatId);
      return { type: chat?.type || 'private' };
    } catch (e) {
      console.warn(`Не удалось получить чат для ${purpose}`, e);
      return { type: 'private' };
    }
  }

  private isEncrypted(chatContext: IChatContext): boolean {
    return chatContext.type !== 'channel';
  }

  async encryptContent(chatId: string, content: string, chatContext: IChatContext) {
    if (!content || !this.isEncrypted(chatContext)) return content;

    return this.cryptoService.encryptMessage(chatId, content);
  }

  async decryptContent(
    chatId: string,
    content: string,
    chatContext: IChatContext,
    senderId: string | null = null
  ): Promise<IDecryptedMessage> {
    if (!content || !this.isEncrypted(chatContext)) return { text: content };

    return this.cryptoService.decryptMessage(chatId, content, senderId ?? '');
  }

  async resolveMediaForDisplay(chatId: string, item: IMessageDto) {
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
      // Адрес берётся из реестра: тот же файл в ленте, в закреплённых и
      // после каждого перезапроса истории получает один и тот же адрес,
      // а не новую копию в памяти.
      const objectUrl =
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
          ? await resolveMediaObjectUrl(mediaUrl, async () => {
              const response = await this.apiClient.get<IEncryptedMedia>(mediaUrl);
              return this.cryptoService.decryptMedia(chatId, response.data);
            })
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

    const trimmedContent = content.trim();
    const chatContext = await this.getChatContext(chatId, 'encryption');
    const encryptedContent = await this.encryptContent(chatId, trimmedContent, chatContext);

    const response = await this.apiClient.put<IMessageDto>(API_ENDPOINTS.MESSAGE_BY_ID(messageId), {
      content: encryptedContent,
    });
    // Как в sendMessage: на сервер уходит шифртекст, в интерфейс — исходный текст.
    const message: IMessageDto = { ...response.data, content: trimmedContent };

    return message;
  }

  async deleteMessage(messageId: string) {
    const response = await this.apiClient.delete<IDeleteMessageResponse>(
      API_ENDPOINTS.MESSAGE_BY_ID(messageId)
    );
    return response.data;
  }

  /**
   * Отмечает сообщения прочитанными и возвращает подтверждённые идентификаторы.
   * Обновление состояния — забота вызывающей стороны: сервис не знает о сторе.
   *
   * Список строится из того, что приняли на сервере, а не из кеша чата:
   * при первом открытии чата кеш ещё пуст, и отметка не доходила до интерфейса.
   */
  async markAsRead(chatId: string, messageIds: string[]) {
    const response = await this.apiClient.post(API_ENDPOINTS.MESSAGE_READ, {
      chatId,
      messageIds,
    });

    return { ...response.data, readIds: messageIds };
  }

  /**
   * Пересылка.
   *
   * Делается на клиенте: у каждого чата свой ключ, и серверная пересылка,
   * копирующая шифртекст как есть, дала бы в целевом чате сообщение,
   * которое не расшифруется никогда. Поэтому текст берётся уже
   * расшифрованным — из ленты, откуда его и выбрали, — и шифруется
   * заново ключом целевого чата.
   *
   * Пометку «переслано» ставит сервер по `forwardedFrom`: он проверяет,
   * что нам видно пересылаемое сообщение, и сам подставляет имя автора.
   * Передаётся всегда идентификатор того сообщения, что пересылаем, даже
   * если оно само переслано, — до оригинала сервер дойдёт сам (#358).
   */
  async forwardMessage(message: IMessageDto, targetChatId: string) {
    const content = message.content ?? '';

    /* Признак надёжнее прежней проверки по ведущему замку: подпись
       переводится, а причина — нет. */
    if ((message as IMessageDto & { undecryptable?: TUndecryptableReason }).undecryptable) {
      throw new Error('Нельзя переслать сообщение, которое не удалось расшифровать');
    }

    const media = (message as IMessageDto & { mediaUrl?: string | null }).mediaUrl;

    if (MEDIA_MESSAGE_TYPES.has(message.type) && media) {
      // Файл уже расшифрован и лежит в памяти вкладки по адресу blob:.
      const blob = await fetch(media).then((response) => response.blob());

      return this.sendMediaMessage(
        targetChatId,
        blob,
        message.type as TMediaMessageType,
        content,
        null,
        message.id
      );
    }

    return this.sendMessage(targetChatId, content, message.type, null, message.id);
  }

  async listReactions(messageId: string) {
    return this.apiClient
      .get<IReactionsResponse>(API_ENDPOINTS.MESSAGE_REACTIONS(messageId))
      .then((response) => response.data?.reactions ?? []);
  }

  async listPins(chatId: string) {
    const pins = await this.apiClient
      .get<IPinnedListResponse>(API_ENDPOINTS.CHAT_PINS(chatId))
      .then((response) => response.data?.pins ?? []);

    const chatContext = await this.getChatContext(chatId, 'decryption');

    return sortMessagesChronologically<IPinnedDto>(
      await Promise.all(
        pins.map(async (item: IPinnedDto) => ({
          ...item,
          message: await this.processMessageForDisplay(chatId, item.message, chatContext),
        }))
      )
    );
  }

  async pinMessage(chatId: string, messageId: string) {
    const response = await this.apiClient.post<ISuccessResponse>(
      API_ENDPOINTS.CHAT_PIN_MESSAGE(chatId, messageId)
    );

    return response.data;
  }

  async unpinMessage(chatId: string, messageId: string) {
    const response = await this.apiClient.delete(API_ENDPOINTS.CHAT_PIN_MESSAGE(chatId, messageId));

    return response.data;
  }

  async reactToMessage(messageId: string, emoji: string): Promise<IEmojisResponse> {
    return this.apiClient
      .post<IEmojisResponse>(API_ENDPOINTS.MESSAGE_REACT(messageId), { emoji })
      .then((response) => response.data);
  }
}
