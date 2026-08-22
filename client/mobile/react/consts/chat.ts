import type { TChatRole, TChatType } from '@/types';

export const CHAT_ROLES: Record<Uppercase<TChatRole>, TChatRole> = {
  ADMIN: 'admin',
  MEMBER: 'member',
  OWNER: 'owner',
} as const;

export const CHAT_TYPES: Record<Uppercase<TChatType>, TChatType> = {
  GROUP: 'group',
  PRIVATE: 'private',
} as const;
