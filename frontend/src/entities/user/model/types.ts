import type { IChatDto, TMessagesList } from '@/types';

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
  /* Чем заменять фотографию, когда её нет: буквой или сеткой от
     идентификатора. Выбор вкусовой, поэтому вынесен человеку (#375). */
  avatarShape: 'letter' | 'grid';
}

/** Кто видит время последнего входа. */
export type TLastSeenVisibility = 'all' | 'contacts' | 'nobody';

export interface IPrivacyDto {
  lastSeen: TLastSeenVisibility;
  messagesFromStrangers: boolean;
}

/**
 * Ответ на запрос настроек: сервер отдаёт настройки и приватность вместе,
 * потому что хранит их в одной строке — двумя колонками jsonb.
 */
export interface ISettingsPayloadDto {
  settings: Partial<ISettingsDto>;
  privacy: Partial<IPrivacyDto>;
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
}

export interface IProfileState extends IProfileModal {
  chat: IChatDto | null;
  messages: TMessagesList;
}
