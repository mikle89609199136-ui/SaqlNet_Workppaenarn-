import type { IChatDto } from '@/types';
import type { TLastSeenApprox } from '@/shared/lib';
import type { components } from '@/types/api.generated';

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

type TNotificationPreferences = components['schemas']['MvpSettings'];

type TAppearancePreferences = Pick<
  components['schemas']['MvpSettings'],
  | 'palette'
  | 'accentPreset'
  | 'textSize'
  | 'chatDensity'
  | 'showMessageTime'
  | 'showMessageStatus'
  | 'showMessageAvatars'
  | 'groupConsecutiveMessages'
>;

/** Типы полей согласованы с каноническим User API. Старые ответы могут быть частичными. */
export interface ISettingsDto
  extends
    TAppearancePreferences,
    Required<Pick<TNotificationPreferences, 'notifications' | 'sounds'>>,
    Pick<TNotificationPreferences, 'callSounds'> {
  language: string;
  theme: NonNullable<components['schemas']['MvpSettings']['theme']>;
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
  /** Кто может звонить (#714, #1043). */
  calls: TPrivacyVisibility;
  messagesFromStrangers: boolean;
}

/**
 * Правила, у которых на экране есть исключения (#786) — те, что сервер
 * применяет (#714, #1043).
 */
export type TPrivacyRule = 'lastSeen' | 'photoVisibility' | 'forwards' | 'calls';

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
   * Что в панели: профиль человека, сведения о группе (#822) или медиа и
   * файлы «Избранного» (#1075). Группа и «Избранное» берутся из открытого
   * чата, поэтому userId у них пустой.
   */
  kind?: 'user' | 'group' | 'saved';
}

export interface IProfileState extends IProfileModal {
  chat: IChatDto | null;
}
