import { authStore } from '../../store/authStore.js';
import apiClient from '../../infrastructure/api/apiFactory.js';
import AuthService from './AuthService.js';
import AdminService from './AdminService.js';
import CallService from './CallService.js';
import ChatService from './ChatService.js';
import MediaService from './MediaService.js';
import MessageService from './MessageService.js';
import CryptoService from './CryptoService.js';
import EmojiService from './EmojiService.js';
import UserService from './UserService.js';

const cryptoService = new CryptoService(apiClient);
if (typeof window !== 'undefined') {
  window.addEventListener('craneapp:auth-session-saved', () => {
    cryptoService.init();
  });
}

export const services = {
  adminService: new AdminService(apiClient),
  authService: new AuthService(apiClient, authStore),
  callService: new CallService(apiClient),
  chatService: new ChatService(apiClient),
  cryptoService: cryptoService,
  emojiService: new EmojiService(apiClient),
  mediaService: new MediaService(apiClient),
  messageService: new MessageService(apiClient, cryptoService),
  userService: new UserService(apiClient),
};

if (typeof window !== 'undefined') {
  window.CraneAppServices = services;
}

export default services;
