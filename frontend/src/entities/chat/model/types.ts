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
  /**
   * Почему сообщение не прочиталось: ключа нет, оно старше нашего
   * появления в чате или в устаревшем формате. Подпись по этой причине
   * подставляет интерфейс — сервису язык неизвестен.
   */
  undecryptable?: 'keyUnavailable' | 'beforeJoin' | 'legacy';
}

export interface IChatDto {
  id: string;
  type: TChatType;
  title: string;
  description: string;
  avatarUrl: string;
  peerPublicKey?: string;
  peerId?: string;
  /* Сервер их шлёт (chat/service.go, ChatDTO), а тип о них не знал:
     обращения к chat.peerIsOnline были в четырёх местах и все считались
     ошибкой типов. Работало только потому, что проверка не запускалась. */
  peerIsOnline?: boolean;
  peerLastSeen?: string;
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

/**
 * Что шифрованию нужно знать о чате.
 *
 * Только тип: ключ принадлежит чату, а не собеседнику, поэтому
 * `peerPublicKey` здесь больше не нужен. Индексной сигнатуры тоже нет —
 * с ней компилировалось обращение к любому выдуманному полю.
 */
export interface IChatContext {
  type: TChatType;
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
