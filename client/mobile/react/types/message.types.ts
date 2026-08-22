import type { IEncryptedMedia } from "./encryption.types";

export type TMessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "voice"
  | "sticker"
  | "gif"
  | "file"
  | "call"
export type TMediaMessageType =
  | "image"
  | "audio"
  | "video"
  | "voice"
  | "sticker"
  | "gif"
  | "file";

interface IForwardedMetadata {
  forwardedFrom: string;
  forwardedSenderName: string;
}

interface IMediaMetadata {
  fileName: string;
  isEncrypted: boolean;
  mediaEncrypted: boolean;
  mediaEncryption: IEncryptedMedia
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

export interface IMessageDto {
  id: string;
  chatId: string;
  senderId: string;
  senderFirstName: string;
  senderName: string;
  content: string;
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
  reactions: TReactionsList;
}

export type TMessagesList = IMessageDto[];



export interface IPinnedMessageDto {
  id: string;
  content: string;
  type: TMessageType;
  senderId: string
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
export interface IMediaItem extends IMessageDto {
  mediaUrl?: string | null;
  mediaEncrypted?: boolean;
  mediaEncryption?: IEncryptedMedia | null;
  mediaUnavailable?: boolean;
  mediaUnavailableReason?: string;
  mediaType?: TMediaMessageType;
}
export interface IMediaDisplayPatch {
  mediaUrl?: string | null;
  mediaOriginalUrl?: string;
  mediaEncrypted?: boolean;
  mediaEncryption?: IEncryptedMedia | null;
  mediaUnavailable?: boolean;
  mediaUnavailableReason?: string;
}


export interface IPinMessagePayload {
  chatId: string;
  messageId: string;
}

export interface IEmojiDto {
  emoji: string
  count: number
  myReaction: boolean
}

export type TEmojisList = IEmojiDto[]

