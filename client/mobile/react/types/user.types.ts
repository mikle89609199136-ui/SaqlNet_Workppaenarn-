export interface IUserDto {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  bio: string;
  avatarUrl: string
  isPremium: boolean
  isBot: boolean
  badges: string[] // неизвестно какое dto у бэйджа
}

export interface ISettingsDto {
  language: string;
  theme: 'dark' | 'light';
  notifications: boolean;
  sounds: boolean;
}

export interface ISearchUserDto {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
}

export type TSearchUsersList = ISearchUserDto[];
