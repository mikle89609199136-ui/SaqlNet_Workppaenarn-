import { apiClient } from '@/api';
import { STORAGE_KEYS } from '@/consts';
import { useProfileStore } from '@/store';

import { AdminService } from './AdminService';
import { AuthService } from './AuthService';
import { CallService } from './CallService';
import { ChatService } from './ChatService';
import { CryptoService } from './CryptoService';
import { EmojiService } from './EmojiService';
import { MediaService } from './MediaService';
import { MessageService } from './MessageService';
import { UserService } from './UserService';

const cryptoService = new CryptoService(apiClient);
if (typeof window !== 'undefined') {
  const initCryptoForCurrentSession = () => {
    if (!window.localStorage.getItem(STORAGE_KEYS.TOKEN)) return;
    if (!window.localStorage.getItem(STORAGE_KEYS.USER)) return;
    cryptoService.init().catch((e) => {
      console.error('CryptoService init failed', e);
    });
  };

  window.addEventListener('craneapp:auth-session-saved', () => {
    initCryptoForCurrentSession();
  });

  window.setTimeout(initCryptoForCurrentSession, 0);
}

export const services = {
  adminService: new AdminService(apiClient),
  authService: new AuthService(apiClient, useProfileStore.getState()),
  callService: new CallService(apiClient),
  chatService: new ChatService(apiClient),
  cryptoService: cryptoService,
  emojiService: new EmojiService(apiClient),
  mediaService: new MediaService(apiClient),
  messageService: new MessageService(apiClient, cryptoService),
  userService: new UserService(apiClient),
};
