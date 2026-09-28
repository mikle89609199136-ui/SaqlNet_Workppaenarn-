import { apiClient as defaultApiClient, type ApiClient } from '@/shared/api';
import { STORAGE_KEYS } from '@/shared/config/storageKeys';
import { useProfileStore } from '@/entities/user/model/profileStore';

import { AdminService } from './AdminService';
import { AuthService } from './AuthService';
import { CallService } from './CallService';
import { ChatService } from './ChatService';
import { CryptoService } from './CryptoService';
import { EmojiService } from './EmojiService';
import { MediaService } from './MediaService';
import { MessageService } from './MessageService';
import { UserService } from './UserService';

/**
 * Доступ к профилю для AuthService. Читает состояние в момент обращения:
 * снимок через getState() заморозил бы token навсегда, и проверка сессии
 * в AuthService всегда видела бы значение на момент загрузки приложения.
 */
function createAuthStorage() {
  return {
    get token() {
      return useProfileStore.getState().token;
    },
    setToken: (token: string) => useProfileStore.getState().setToken(token),
    setUser: (user: Parameters<ReturnType<typeof useProfileStore.getState>['setUser']>[0]) =>
      useProfileStore.getState().setUser(user),
    clearProfile: () => useProfileStore.getState().clearProfile(),
  };
}

export function createServices(apiClient: ApiClient = defaultApiClient) {
  const cryptoService = new CryptoService(apiClient);

  return {
    adminService: new AdminService(apiClient),
    authService: new AuthService(apiClient, createAuthStorage()),
    callService: new CallService(apiClient),
    chatService: new ChatService(apiClient),
    cryptoService,
    emojiService: new EmojiService(apiClient),
    mediaService: new MediaService(apiClient),
    messageService: new MessageService(apiClient, cryptoService),
    userService: new UserService(apiClient),
  };
}

export type TServices = ReturnType<typeof createServices>;

export const services = createServices();

/**
 * Подготавливает ключи шифрования для текущей сессии и следит за входом.
 *
 * Вызывается из точки входа приложения, а не при импорте модуля: иначе любой
 * код, которому нужен один сервис, запускал бы инициализацию криптографии
 * и подписку на window — включая тесты.
 */
export function startCryptoAutoInit(target: TServices = services): () => void {
  if (typeof window === 'undefined') return () => {};

  const initCryptoForCurrentSession = () => {
    if (!window.localStorage.getItem(STORAGE_KEYS.TOKEN)) return;
    if (!window.localStorage.getItem(STORAGE_KEYS.USER)) return;
    target.cryptoService.init().catch((e) => {
      console.error('CryptoService init failed', e);
    });
  };

  window.addEventListener('craneapp:auth-session-saved', initCryptoForCurrentSession);
  const timer = window.setTimeout(initCryptoForCurrentSession, 0);

  return () => {
    window.removeEventListener('craneapp:auth-session-saved', initCryptoForCurrentSession);
    window.clearTimeout(timer);
  };
}
