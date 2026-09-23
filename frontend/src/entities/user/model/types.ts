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

export interface ICheckUsernameResponse {
  available: boolean;
}

export interface IUserStatusDto {
  isOnline: boolean;
  lastSeen: string;
}

export interface INotificationSettingsDto {
  privateChats?: boolean;
  groups?: boolean;
  channels?: boolean;
  calls?: boolean;
  videoCalls?: boolean;
  inAppNotifications?: boolean;
  messagePreview?: boolean;
  readReceipts?: boolean;
  reactions?: boolean;
  newContacts?: boolean;
}

export interface ISoundSettingsDto {
  notificationsVolume?: number;
  mediaVolume?: number;
  notificationsSound?: boolean;
  messagesSound?: boolean;
  sendSound?: boolean;
  callsSound?: boolean;
  vibrateOnCall?: boolean;
  notificationSound?: string;
  messageSound?: string;
  ringtone?: string;
}

export interface IStorageSettingsDto {
  keepMedia?: string;
  maxCacheSizeMb?: number;
  autoDownloadPhotos?: boolean;
  autoDownloadVideos?: boolean;
  autoDownloadFiles?: boolean;
}

export interface IAdvancedSettingsDto {
  autoReconnect?: boolean;
  fastConnection?: boolean;
  connectionType?: string;
  dataCompression?: boolean;
  saveDrafts?: boolean;
  analytics?: boolean;
  developerMode?: boolean;
  debugLog?: boolean;
  hardwareAcceleration?: boolean;
  autoplayGifs?: boolean;
}

export interface IChatFolderDto {
  id?: string;
  name?: string;
  icon?: string;
  includedChatIds?: string[];
  excludedChatIds?: string[];
}

export interface IAllSettingsDto {
  settings?: Partial<ISettingsDto>;
  privacySettings?: Partial<IPrivacyDto>;
  notificationSettings?: Partial<INotificationSettingsDto>;
  soundSettings?: Partial<ISoundSettingsDto>;
  storageSettings?: Partial<IStorageSettingsDto>;
  advancedSettings?: Partial<IAdvancedSettingsDto>;
  folders?: IChatFolderDto[];
  passcodeEnabled?: boolean;
  passcodeTimeout?: number;
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
