import type { IChatDto } from '@/entities/chat';
import type { IMessageDto, IPinnedDto } from '@/entities/message';
import type { IUserDto } from '@/entities/user';

/**
 * Фабрики тестовых данных.
 *
 * Значения по умолчанию подобраны так, чтобы тест описывал только то,
 * что проверяет. Каждый вызов даёт новый идентификатор, а метки времени
 * растут монотонно — порядок сообщений становится предсказуемым.
 */

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/** База отсчёта времени. Фиксированная, чтобы тесты не зависели от часов. */
const EPOCH = new Date('2026-08-01T10:00:00.000Z').getTime();

function nextTimestamp(): Date {
  sequence += 1;
  return new Date(EPOCH + sequence * 60_000);
}

export function resetFixtures(): void {
  sequence = 0;
}

export function makeUser(overrides: Partial<IUserDto> = {}): IUserDto {
  return {
    id: nextId('user'),
    username: 'tester',
    firstName: 'Тестовый',
    lastName: 'Пользователь',
    avatarUrl: '',
    bio: '',
    ...overrides,
  } as IUserDto;
}

export function makeMessage(overrides: Partial<IMessageDto> = {}): IMessageDto {
  const createdAt = overrides.createdAt ?? nextTimestamp();

  return {
    id: nextId('message'),
    chatId: 'chat-1',
    senderId: 'user-1',
    senderName: 'Тестовый',
    senderFirstName: 'Тестовый',
    content: 'текст сообщения',
    type: 'text',
    createdAt,
    updatedAt: createdAt,
    isEdited: false,
    isForwarded: false,
    isPinned: false,
    replyTo: null,
    replyToMessageId: null,
    replySenderName: null,
    replyToSenderName: null,
    forwardedSenderName: '',
    reactions: [],
    ...overrides,
  } as IMessageDto;
}

/**
 * Закреплённое сообщение.
 *
 * `id` и `messageId` намеренно различаются: в коде есть места, где одно
 * сравнивается с другим, и при совпадающих значениях такая ошибка невидима.
 */
export function makePin(overrides: Partial<IPinnedDto> = {}): IPinnedDto {
  const message = overrides.message ?? makeMessage({ isPinned: true });

  return {
    id: nextId('pin'),
    messageId: message.id,
    chatId: message.chatId,
    pinnedBy: 'user-1',
    pinnedAt: nextTimestamp(),
    ...overrides,
    message,
  };
}

export function makeChat(overrides: Partial<IChatDto> = {}): IChatDto {
  const createdAt = nextTimestamp();

  return {
    id: nextId('chat'),
    type: 'private',
    title: 'Тестовый чат',
    description: '',
    avatarUrl: '',
    peerPublicKey: undefined,
    peerId: 'user-2',
    ownerId: 'user-1',
    role: 'member',
    isPinned: false,
    isArchived: false,
    lastSeenAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    memberCount: 2,
    ...overrides,
  } as IChatDto;
}

/**
 * Чат с историей: сообщения получают правильный chatId, а закреплённые
 * ссылаются на реально существующие сообщения этого чата.
 */
export function makeChatScenario(
  options: {
    messages?: number;
    pinned?: number;
    chat?: Partial<IChatDto>;
  } = {}
) {
  const chat = makeChat(options.chat);
  const messages = Array.from({ length: options.messages ?? 3 }, (_, index) =>
    makeMessage({ chatId: chat.id, content: `сообщение ${index + 1}` })
  );
  const pins = messages
    .slice(0, options.pinned ?? 0)
    .map((message) => makePin({ message: { ...message, isPinned: true } }));

  return { chat, messages, pins };
}
