import type { IChatDto } from '@/types';
import type { TLastSeenApprox } from '@/shared/lib';

export interface IUserDto {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  bio: string;
  avatarUrl: string;
  isPremium: boolean;
  isBot: boolean;
  badges: string[]; // неизвестно какое dto у бэйджа
}

export interface ISettingsDto {
  language: string;
  theme: 'dark' | 'light';
  notifications: boolean;
  sounds: boolean;
  callSounds?: boolean;
  /* Чем заменять фотографию, когда её нет: буквой или сеткой от
     идентификатора. Выбор вкусовой, поэтому вынесен человеку (#375). */
  avatarShape: 'letter' | 'grid';
}

/** Правило приватности. Контактов нет — только «все» и «никто». */
export type TPrivacyVisibility = 'all' | 'nobody';

/** Кто видит время последнего входа. */
export type TLastSeenVisibility = TPrivacyVisibility;

export interface IPrivacyDto {
  lastSeen: TLastSeenVisibility;
  /** Кто видит фото профиля (#789). */
  photoVisibility: TPrivacyVisibility;
  /** Кто может ссылаться на мой аккаунт, пересылая мои сообщения (#785). */
  forwards: TPrivacyVisibility;
  messagesFromStrangers: boolean;
}

/**
 * Правила, у которых на экране есть исключения (#786) — те, что сервер
 * применяет. «Звонки» добавятся вместе с #714.
 */
export type TPrivacyRule = 'lastSeen' | 'photoVisibility' | 'forwards';

/** allow — «Всегда разрешать», deny — «Никогда не разрешать». */
export type TPrivacyExceptionMode = 'allow' | 'deny';

/** Человек в исключениях правила (#784). Фото — по его правилу «Фото». */
export interface IPrivacyExceptionDto {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  rule: TPrivacyRule;
  mode: TPrivacyExceptionMode;
  createdAt: string;
}

/** Человек из чёрного списка (#727). Фото — по его правилу «Фото» (#789). */
export interface IBlockedUserDto {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  blockedAt: string;
}

/**
 * Ответ на запрос настроек: сервер отдаёт настройки и приватность вместе,
 * потому что хранит их в одной строке — двумя колонками jsonb.
 */
export interface ISettingsPayloadDto {
  settings: Partial<ISettingsDto>;
  privacy: Partial<IPrivacyDto>;
}

export interface ICheckUsernameResponse {
  available: boolean;
}

export interface IUserStatusDto {
  isOnline: boolean;
  lastSeen: string;
  lastSeenApprox?: TLastSeenApprox;
}

export interface ISearchUserDto {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
}

export type TSearchUsersList = ISearchUserDto[];

export interface IProfileModal {
  isOpen: boolean;
  /** Чей профиль показывать. Сами данные читает панель — по этому идентификатору. */
  userId: string | null;
  /**
   * Что в панели: профиль человека или сведения о группе (#822). Группа
   * берётся из открытого чата, поэтому userId у неё пустой.
   */
  kind?: 'user' | 'group';
}

export interface IProfileState extends IProfileModal {
  chat: IChatDto | null;
}
