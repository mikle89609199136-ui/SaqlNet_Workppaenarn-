import type { IMessageEntity } from '@/shared/lib/richText';
import type { IVoiceMeta } from '@/shared/lib/voice';
import type { IEncryptedMedia } from '@/types/encryption.types';

export type TMessageType =
  'text' | 'image' | 'audio' | 'video' | 'voice' | 'sticker' | 'gif' | 'file' | 'call';
export type TMediaMessageType = 'image' | 'audio' | 'video' | 'voice' | 'sticker' | 'gif' | 'file';

interface IForwardedMetadata {
  /** Исходное сообщение. Нет, если автор запретил ссылку на себя (#785). */
  forwardedFrom?: string;
  /** Автор запретил пересылающему ссылку на себя: осталось только имя. */
  forwardedHidden?: boolean;
  forwardedSenderId?: string;
  forwardedSenderName: string;
}

interface IMediaMetadata {
  fileName: string;
  isEncrypted: boolean;
  mediaEncrypted: boolean;
  mediaEncryption: IEncryptedMedia;
  mediaType: TMediaMessageType;
  mediaUrl: string;
  sizeBytes: number;
}

export interface IReaction {
  emoji: string;
  count: number;
  myReaction: boolean;
}

export type TReactionsList = IReaction[];

export type TMessageDeliveryStatus = 'pending' | 'uploading' | 'failed' | 'sent' | 'read';

export interface IMessageDto {
  id: string;
  chatId: string;
  senderId: string;
  senderFirstName: string;
  /** Фото автора — сервер присылает, аватарка в группе берёт его (#820). */
  senderAvatar?: string;
  senderName: string;
  content: string;
  /**
   * Форматирование текста (#656). В зашифрованных чатах приходит из самого
   * конверта после расшифровки; в каналах — открытым полем с сервера.
   */
  entities?: IMessageEntity[];
  type: TMessageType;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
  isForwarded: boolean;
  isPinned: boolean;
  replyTo: string | null;
  replyToMessageId: string | null;
  replySenderName: string | null;
  replyToSenderName: string | null;
  metadata?: IForwardedMetadata | IMediaMetadata;
  forwardedSenderName: string;
  /** Автор оригинала — чтобы открыть его профиль. Нет, если он запретил ссылку (#785). */
  forwardedSenderId?: string;
  reactions: TReactionsList;
  /**
   * Удалось ли подтвердить автора подписью. `false` — не удалось: текст
   * показывается, но с оговоркой.
   */
  senderVerified?: boolean;
  /**
   * Почему сообщение не прочиталось: ключа нет, оно старше нашего
   * появления в чате или в устаревшем формате. Подпись по этой причине
   * подставляет интерфейс — сервису язык неизвестен.
   */
  undecryptable?: 'keyUnavailable' | 'beforeJoin' | 'legacy';
  /** Длительность и волна голосового (#843): из шифрованного конверта. */
  voice?: IVoiceMeta;
  /**
   * Своё сообщение (#657): когда собеседник его получил и прочитал — время
   * сервера. Нет поля — ещё нет.
   */
  deliveredAt?: string;
  readAt?: string;
  /** Проставляются после подтверждения отметки о прочтении сервером. */
  isRead?: boolean;
  /** Статус доставки/отправки сообщения (#552 Outbox) */
  status?: TMessageDeliveryStatus;
  /** Временный ID для корреляции оптимистичного баббла с ответом сервера */
  tempId?: string;
}

export type TMessagesList = IMessageDto[];

/** Вид общего в переписке (#842): фото и видео, файлы и аудио, текст (для ссылок). */
export type TSharedKind = 'media' | 'files' | 'text';

export interface IPinnedMessageDto {
  id: string;
  content: string;
  type: TMessageType;
  senderId: string;
}

export interface IPinnedDto {
  id: string;
  messageId: string;
  pinnedBy: string;
  pinnedAt: Date;
  chatId: string;
  message: IMessageDto;
}

export type TPinnedList = IPinnedDto[];

export interface IMediaPayload {
  ciphertext?: unknown;
  fileName?: string;
  isEncrypted?: boolean;
  mediaEncrypted?: boolean;
  mediaEncryption?: IEncryptedMedia;
  mediaType?: TMediaMessageType;
  mediaUrl?: string;
  sizeBytes?: number;
  [key: string]: unknown;
}
/**
 * Почему вложение не показать. Код, а не фраза: сервис языка не знает,
 * подпись подставляет интерфейс (MessageMedia).
 */
export type TMediaUnavailableReason =
  | 'unencrypted'
  | 'foreign'
  | 'decryptFailed'
  /** Не скачался: сеть, 5xx, 429 — можно повторить (#1062). */
  | 'downloadFailed'
  /** Файла нет на сервере (404, 410). */
  | 'notFound'
  /** Нет доступа к файлу (403). */
  | 'forbidden';

export interface IMediaItem extends IMessageDto {
  mediaUrl?: string | null;
  mediaEncrypted?: boolean;
  mediaEncryption?: IEncryptedMedia | null;
  mediaUnavailable?: boolean;
  mediaUnavailableReason?: TMediaUnavailableReason;
  mediaType?: TMediaMessageType;
}
export interface IMediaDisplayPatch {
  mediaUrl?: string | null;
  mediaOriginalUrl?: string;
  mediaEncrypted?: boolean;
  mediaEncryption?: IEncryptedMedia | null;
  mediaUnavailable?: boolean;
  mediaUnavailableReason?: TMediaUnavailableReason;
}

export interface IPinMessagePayload {
  chatId: string;
  messageId: string;
}

export interface IEmojiDto {
  emoji: string;
  count: number;
  myReaction: boolean;
}

export type TEmojisList = IEmojiDto[];
