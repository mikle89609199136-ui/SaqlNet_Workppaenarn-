import { API_ENDPOINTS, ApiClient } from '@/shared/api';
import { toPlayableVoiceBlob, type IVoiceMeta } from '@/shared/lib/voice';
import { resolveMediaObjectUrl } from '@/entities/media/model/mediaObjectUrls';
import { resolveChat } from '@/entities/chat/model/chatResolver';
import type {
  IChatContext,
  IDeleteMessageResponse,
  IEmojisResponse,
  IEncryptedMedia,
  ILastMessageDto,
  IMediaItem,
  IMessageDto,
  IUploadResponse,
  IMessagesResponse,
  IPinnedDto,
  IPinnedListResponse,
  IReactionsResponse,
  ISuccessResponse,
  TMediaMessageType,
  TMessagesList,
  TMessageType,
  TSharedKind,
} from '@/types';
import { MAX_MESSAGES_PER_SEND } from '@/shared/config';
import { trimRichText, type IMessageEntity } from '@/shared/lib/richText';
import { sortMessagesChronologically } from '@/shared/lib';
import type { CryptoService, IDecryptedMessage, TUndecryptableReason } from './CryptoService';

const MEDIA_MESSAGE_TYPES = new Set(['image', 'video', 'audio', 'voice', 'file', 'gif', 'sticker']);
/** Одно сообщение отправки: что уходит на сервер и как показать ответ у нас. */
interface IPreparedSend {
  item: Record<string, unknown>;
  toDisplay: (sent: IMessageDto) => IMessageDto | Promise<IMessageDto>;
}

const LEGACY_MEDIA_UNAVAILABLE = 'Медиа недоступно: файл не зашифрован';

/** Загрузка в сервисе медиа — единственный адрес вложения, который скачиваем (#871). */
const OWN_MEDIA_URL =
  /^\/api\/v2\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOwnMediaUrl(url: string): boolean {
  return OWN_MEDIA_URL.test(url);
}

const FOREIGN_MEDIA_UNAVAILABLE = 'Медиа недоступно: файл не из этого приложения';

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

  /**
   * Общее в переписке для профиля (#842): одна страница сообщений вида kind
   * от новых к старым, расшифрованная так же, как лента. nextCursor —
   * передать в before за следующей; нет — дальше ничего.
   */
  async fetchSharedPage(
    chatId: string,
    kind: TSharedKind,
    before?: string,
    limit: number = 24
  ): Promise<{ messages: TMessagesList; nextCursor?: string }> {
    const response = await this.apiClient.get<{ messages?: IMessageDto[]; nextCursor?: string }>(
      API_ENDPOINTS.CHAT_SHARED(chatId),
      { kind, limit, ...(before ? { before } : {}) }
    );
    const items = response.data.messages ?? [];
    if (items.length === 0) return { messages: [], nextCursor: undefined };

    const chatContext = await this.getChatContext(chatId, 'decryption');
    const messages = await Promise.all(
      items.map((item) => this.processMessageForDisplay(chatId, item, chatContext))
    );
    return { messages, nextCursor: response.data.nextCursor || undefined };
  }

  /** Сколько видимых сообщений ленты новее этого — чтобы догрузить ленту до него (#842). */
  async getMessagePosition(chatId: string, messageId: string): Promise<number> {
    const response = await this.apiClient.get<{ position: number }>(
      API_ENDPOINTS.MESSAGE_POSITION(chatId, messageId)
    );
    return response.data.position;
  }

  /**
   * Отправка — всегда пачкой (#808): одно сообщение — пачка из одного.
   * Сервер пишет пачку одной транзакцией, в её порядке, и отвечает
   * сообщениями в том же порядке.
   */
  private async sendPrepared(chatId: string, prepared: IPreparedSend[]): Promise<IMessageDto[]> {
    if (prepared.length === 0) return [];
    if (prepared.length > MAX_MESSAGES_PER_SEND) {
      throw new Error(`Не больше ${MAX_MESSAGES_PER_SEND} сообщений за одну отправку`);
    }

    const response = await this.apiClient.post<IMessagesResponse>(
      API_ENDPOINTS.MESSAGE_SEND(chatId),
      { messages: prepared.map(({ item }) => item) }
    );

    const sent = response.data.messages;
    return Promise.all(prepared.map(({ toDisplay }, index) => toDisplay(sent[index])));
  }

  /** Текст: шифруется ключом чата, показывается у нас как есть. */
  private async prepareText(
    chatId: string,
    content: string,
    type: TMessageType,
    replyTo: string | null,
    forwardedFrom: string | null,
    chatContext: IChatContext,
    entities: IMessageEntity[] = []
  ): Promise<IPreparedSend> {
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Message must be a string');
    }

    const plain = trimRichText({ text: content, entities });
    const sealed =
      type === 'text'
        ? await this.encryptContent(chatId, plain.text, chatContext, plain.entities)
        : { content: plain.text, entities: [] };

    return {
      item: {
        content: sealed.content,
        type,
        replyTo,
        ...(sealed.entities.length > 0 ? { entities: sealed.entities } : {}),
        ...(forwardedFrom ? { forwardedFrom } : {}),
      },
      toDisplay: (sent) => ({ ...sent, content: plain.text, entities: plain.entities }),
    };
  }

  /**
   * Файл: шифруется, загружается отдельно, в сообщение уходит ссылка на
   * загруженное. Подпись — как текст.
   */
  private async prepareMedia(
    chatId: string,
    media: Blob,
    mediaType: TMediaMessageType,
    caption: string,
    replyTo: string | null,
    forwardedFrom: string | null,
    chatContext: IChatContext,
    captionEntities: IMessageEntity[] = [],
    voice?: IVoiceMeta
  ): Promise<IPreparedSend> {
    if (!MEDIA_MESSAGE_TYPES.has(mediaType)) {
      throw new Error(`Unsupported media message type: ${mediaType}`);
    }

    const encryptedMedia = await this.cryptoService.encryptMedia(chatId, media);
    const uploadResponse = await this.apiClient.post<IUploadResponse>(API_ENDPOINTS.MEDIA_UPLOAD, {
      file: encryptedMedia,
      type: mediaType,
      purpose: 'message',
    });

    const plainCaption = trimRichText({ text: caption || '', entities: captionEntities });
    const trimmedCaption = plainCaption.text;
    // Голосовое без подписи — тоже конверт: в нём длительность и волна (#843).
    const sealedCaption =
      trimmedCaption || voice
        ? await this.encryptContent(
            chatId,
            trimmedCaption,
            chatContext,
            plainCaption.entities,
            voice
          )
        : { content: '', entities: [] };
    // Never copy the upload response wholesale into message metadata. Some
    // deployments return the ciphertext inside `encryption`, which makes the
    // subsequent /messages request as large as the file and trips the chat
    // service JSON limit. The media service already stores the ciphertext.
    const mediaEncryption = this.mediaMetadataFromPayload(encryptedMedia);
    const uploadedUrl = uploadResponse.data?.url;

    return {
      item: {
        content: sealedCaption.content,
        ...(sealedCaption.entities.length > 0 ? { entities: sealedCaption.entities } : {}),
        type: mediaType,
        replyTo,
        mediaUrl: uploadedUrl,
        mediaType,
        mediaEncrypted: true,
        mediaEncryption,
        isEncrypted: Boolean(sealedCaption.content),
        ...(forwardedFrom ? { forwardedFrom } : {}),
      },
      toDisplay: async (sent) => {
        // Тот же реестр, что и при показе: когда лента перезапросится, для
        // этого файла вернётся уже готовый адрес, а не вторая копия.
        const canRegister =
          Boolean(uploadedUrl) &&
          typeof URL !== 'undefined' &&
          typeof URL.createObjectURL === 'function';
        const localUrl =
          canRegister && uploadedUrl
            ? await resolveMediaObjectUrl(uploadedUrl, async () => {
                const blob = await this.cryptoService.decryptMedia(chatId, encryptedMedia);
                return mediaType === 'voice' ? toPlayableVoiceBlob(blob) : blob;
              })
            : uploadedUrl;

        return {
          ...sent,
          content: trimmedCaption,
          entities: plainCaption.entities,
          ...(voice ? { voice } : {}),
          mediaUrl: localUrl,
          mediaEncrypted: true,
          mediaEncryption,
        } as IMessageDto;
      },
    };
  }

  async sendMessage(
    chatId: string,
    content: string,
    type: TMessageType = 'text',
    replyTo: string | null = null,
    entities: IMessageEntity[] = []
  ): Promise<IMessageDto> {
    const chatContext = await this.getChatContext(chatId, 'encryption');
    const prepared = await this.prepareText(
      chatId,
      content,
      type,
      replyTo,
      null,
      chatContext,
      entities
    );
    const [message] = await this.sendPrepared(chatId, [prepared]);

    return message;
  }

  async sendMediaMessage(
    chatId: string,
    media: Blob,
    mediaType: TMediaMessageType,
    caption: string = '',
    replyTo: string | null = null,
    captionEntities: IMessageEntity[] = [],
    voice?: IVoiceMeta
  ): Promise<IMediaItem> {
    const chatContext = await this.getChatContext(chatId, 'media encryption');
    const prepared = await this.prepareMedia(
      chatId,
      media,
      mediaType,
      caption,
      replyTo,
      null,
      chatContext,
      captionEntities,
      voice
    );
    const [message] = await this.sendPrepared(chatId, [prepared]);

    return message as IMediaItem;
  }

  async sendSticker(
    chatId: string,
    mediaUrl: string,
    replyTo: string | null = null
  ): Promise<IMessageDto> {
    const prepared: IPreparedSend = {
      item: {
        content: '',
        type: 'sticker',
        replyTo,
        mediaUrl,
        mediaType: 'sticker',
        mediaEncrypted: false,
      },
      toDisplay: (sent) =>
        ({
          ...sent,
          content: '',
          type: 'sticker',
          mediaUrl,
          mediaType: 'sticker',
          mediaEncrypted: false,
          mediaUnavailable: false,
        }) as IMessageDto,
    };
    const [message] = await this.sendPrepared(chatId, [prepared]);
    return message;
  }

  async sendGif(
    chatId: string,
    mediaUrl: string,
    replyTo: string | null = null
  ): Promise<IMessageDto> {
    const prepared: IPreparedSend = {
      item: {
        content: '',
        type: 'gif',
        replyTo,
        mediaUrl,
        mediaType: 'gif',
        mediaEncrypted: false,
      },
      toDisplay: (sent) =>
        ({
          ...sent,
          content: '',
          type: 'gif',
          mediaUrl,
          mediaType: 'gif',
          mediaEncrypted: false,
          mediaUnavailable: false,
        }) as IMessageDto,
    };
    const [message] = await this.sendPrepared(chatId, [prepared]);
    return message;
  }

  async processMessageForDisplay(
    chatId: string,
    item: IMessageDto,
    chatContext: IChatContext | null = null
  ) {
    const context = chatContext || (await this.getChatContext(chatId, 'display'));
    let content = item.content;
    // В каналах форматирование приходит открытым полем, в шифрованных чатах —
    // из конверта: серверное поле там всегда пустое.
    let entities = item.entities ?? [];
    let senderVerified: boolean | undefined;
    let voice: IVoiceMeta | undefined;
    /* Причина, по которой сообщение не прочиталось, едет вместе с ним:
       подпись подставит тот, кто рисует, — он знает язык. */
    let undecryptable: TUndecryptableReason | undefined;

    if (content) {
      const decrypted = await this.decryptContent(chatId, content, context, item.senderId);
      content = decrypted.text;
      if (decrypted.entities) entities = decrypted.entities;
      senderVerified = decrypted.senderVerified;
      undecryptable = decrypted.undecryptable;
      // Только у голосового: у прочих метаданные из конверта не нужны.
      if (item.type === 'voice') voice = decrypted.voice;
    }

    const mediaPatch = await this.resolveMediaForDisplay(chatId, item);
    return {
      ...item,
      content,
      entities,
      senderVerified,
      undecryptable,
      ...(voice ? { voice } : {}),
      ...mediaPatch,
    };
  }

  async processPinnedMessageForDisplay(
    chatId: string,
    message: IPinnedDto,
    chatContext: IChatContext | null = null
  ): Promise<IPinnedDto> {
    const context = chatContext || (await this.getChatContext(chatId, 'display'));

    let content = message.message.content;
    let entities = message.message.entities ?? [];
    if (content) {
      const decrypted = await this.decryptContent(
        chatId,
        content,
        context,
        message.message.senderId
      );
      content = decrypted.text;
      if (decrypted.entities) entities = decrypted.entities;
    }

    const mediaPatch = await this.resolveMediaForDisplay(chatId, message.message);

    return {
      ...message,
      message: { ...message.message, content, entities, ...mediaPatch },
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

  /**
   * Что уходит на сервер: содержимое и открытое форматирование. В
   * шифрованных чатах форматирование едет внутри конверта (v3), и открытое
   * поле пустое; в каналах текст не шифруется, и форматирование открытое.
   */
  async encryptContent(
    chatId: string,
    content: string,
    chatContext: IChatContext,
    entities: IMessageEntity[] = [],
    voice?: IVoiceMeta
  ): Promise<{ content: string; entities: IMessageEntity[] }> {
    /* Метаданные голосового — только внутри шифровки (#843): в открытом
       чате их нет вовсе, открыто их не отправляем. */
    if (!this.isEncrypted(chatContext)) return { content, entities };
    if (!content && !voice) return { content, entities };

    return {
      content: await this.cryptoService.encryptMessage(chatId, content, entities, voice),
      entities: [],
    };
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

    const mediaUrl =
      (metadata && 'mediaUrl' in metadata ? metadata.mediaUrl : null) ||
      ((item as unknown as { mediaUrl?: string }).mediaUrl ?? null);

    if (!mediaUrl) return {};

    // Стикеры и GIF не шифруются сквозным шифрованием файлов и могут ссылаться на внешний каталог или статику
    if (item.type === 'sticker' || item.type === 'gif') {
      return {
        mediaUrl,
        mediaOriginalUrl: mediaUrl,
        mediaEncrypted: false,
        mediaUnavailable: false,
      };
    }

    if (!metadata || !('mediaUrl' in metadata)) {
      return {};
    }

    /* Скачиваем только загрузки сервиса медиа (#871). Любой другой адрес —
       чужой сервер или другой маршрут API — не трогаем: запрос ушёл бы
       теми же средствами, что и запросы к API. */
    if (!isOwnMediaUrl(mediaUrl)) {
      return {
        mediaUrl: null,
        mediaEncrypted: Boolean(metadata.mediaEncrypted),
        mediaUnavailable: true,
        mediaUnavailableReason: FOREIGN_MEDIA_UNAVAILABLE,
      };
    }

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
              const blob = await this.cryptoService.decryptMedia(chatId, response.data);
              // Голосовое, которое браузер сам не проиграет, — перекодируется (#843).
              return item.type === 'voice' ? toPlayableVoiceBlob(blob) : blob;
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

  async editMessage(
    messageId: string,
    chatId: string,
    content: string,
    entities: IMessageEntity[] = []
  ) {
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Message must be a string');
    }

    const plain = trimRichText({ text: content, entities });
    const chatContext = await this.getChatContext(chatId, 'encryption');
    const sealed = await this.encryptContent(chatId, plain.text, chatContext, plain.entities);

    // Правка заменяет форматирование целиком: прежние диапазоны к новому
    // тексту не относятся.
    const response = await this.apiClient.put<IMessageDto>(API_ENDPOINTS.MESSAGE_BY_ID(messageId), {
      content: sealed.content,
      entities: sealed.entities,
    });
    // Как в sendMessage: на сервер уходит шифртекст, в интерфейс — исходный текст.
    const message: IMessageDto = {
      ...response.data,
      content: plain.text,
      entities: plain.entities,
    };

    return message;
  }

  /**
   * Удаляет сообщения одного чата (#840): `forEveryone` — у всех (только
   * свои), иначе только у себя. До 100 за раз, всё или ничего.
   */
  async deleteMessages(chatId: string, messageIds: string[], forEveryone: boolean) {
    const response = await this.apiClient.post<IDeleteMessageResponse>(
      API_ENDPOINTS.CHAT_MESSAGES_DELETE(chatId),
      { messageIds, forEveryone }
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
    const response = await this.apiClient.post<{ readIds?: string[]; lastReadAt?: string }>(
      API_ENDPOINTS.MESSAGE_READ,
      { chatId, messageIds }
    );

    /* Прочитанными помечается то, что учёл сервер (#506): свои и удалённые
       он пропускает. Старый ответ без readIds — отправленные, как раньше. */
    return { ...response.data, readIds: response.data?.readIds ?? messageIds };
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
   *
   * Всё уходит одной пачкой (#808): комментарий первым, обычным
   * сообщением, за ним пересланные в том порядке, в каком переданы. Пачка
   * пишется целиком или не пишется вовсе.
   */
  async forwardMessages(
    targetChatId: string,
    originals: IMessageDto[],
    comment: string = '',
    commentEntities: IMessageEntity[] = []
  ): Promise<IMessageDto[]> {
    // До подготовки: у файлов она означает загрузку, и грузить то, что
    // всё равно не уйдёт, незачем.
    if (originals.length + (comment.trim() ? 1 : 0) > MAX_MESSAGES_PER_SEND) {
      throw new Error(`Не больше ${MAX_MESSAGES_PER_SEND} сообщений за одну отправку`);
    }

    const chatContext = await this.getChatContext(targetChatId, 'encryption');
    const prepared: IPreparedSend[] = [];

    if (comment.trim()) {
      prepared.push(
        await this.prepareText(
          targetChatId,
          comment,
          'text',
          null,
          null,
          chatContext,
          commentEntities
        )
      );
    }

    for (const original of originals) {
      prepared.push(await this.prepareForward(original, targetChatId, chatContext));
    }

    return this.sendPrepared(targetChatId, prepared);
  }

  private async prepareForward(
    message: IMessageDto,
    targetChatId: string,
    chatContext: IChatContext
  ): Promise<IPreparedSend> {
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

      return this.prepareMedia(
        targetChatId,
        blob,
        message.type as TMediaMessageType,
        content,
        null,
        message.id,
        chatContext,
        message.entities ?? [],
        message.type === 'voice' ? message.voice : undefined
      );
    }

    // Форматирование едет вместе с текстом и шифруется ключом нового чата.
    return this.prepareText(
      targetChatId,
      content,
      message.type,
      null,
      message.id,
      chatContext,
      message.entities ?? []
    );
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
