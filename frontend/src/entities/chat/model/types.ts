import type { TLastSeenApprox } from '@/shared/lib';
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
  /** Своё последнее сообщение (#657): когда доставлено и прочитано. */
  deliveredAt?: string;
  readAt?: string;
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
  /** Промежуток вместо скрытого времени (#791): recently, within_week, within_month, long_ago. */
  peerLastSeenApprox?: TLastSeenApprox;
  /** Собеседник заблокировал вас: писать и звонить нельзя (#760). */
  isBlockedByPeer?: boolean;
  /** Вы заблокировали собеседника. */
  isPeerBlocked?: boolean;
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
  /**
   * До какого момента чат прочитан (время сервера): чужие новее — непрочитанные,
   * так считается `unreadCount`. Пусто — ещё не читали (#839).
   */
  lastReadAt?: string;
  lastMessage?: ILastMessageDto;
  /**
   * Звук чата выключен (#559, #467): приглушённый счётчик и значок после
   * имени. Сервер в списке чатов его пока не присылает.
   */
  isMuted?: boolean;
  /**
   * Отмечен непрочитанным вручную — пустой кружок вместо числа. Функции
   * пока нет, строка к ней готова (#819).
   */
  isMarkedUnread?: boolean;
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

/** Вложение, ждущее отправки в композере. Их может быть несколько. */
export interface IPendingAttachment {
  /** Ключ в списке: один и тот же файл можно приложить дважды. */
  id: string;
  file: File;
  type: TMediaMessageType;
}
