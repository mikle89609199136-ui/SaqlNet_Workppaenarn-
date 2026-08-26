import type { TMediaMessageType, TMessageType, TReactionsList } from '@/types';

export type TChatType = 'private' | 'group' | 'channel';

export type TChatRole = 'member' | 'admin' | 'owner';

export interface ILastMessageDto {
  id: string;
  content: string;
  type: TMessageType;
  senderId: string;
  senderName: string;
  reactions: TReactionsList;
}

export interface IChatDto {
  id: string;
  type: TChatType;
  title: string;
  description: string;
  avatarUrl: string;
  peerPublicKey?: string;
  peerId?: string;
  ownerId: string;
  role: TChatRole;
  isPinned: boolean;
  isArchived: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  lastMessageAt?: Date;
  unreadCount: number;
  lastMessage?: ILastMessageDto;
}

export type TChatsList = IChatDto[];

export interface IChatContext {
  type: TChatType;
  peerPublicKey: string | null;
  [key: string]: unknown;
}

export interface IMemberDto {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  role: string;
  permissions: Record<string, unknown>;
  mutedUntil?: string;
  joinedAt: string;
}

export type TMembersList = IMemberDto[];

export interface IPendingAttachment {
  file: File;
  type: TMediaMessageType;
}
