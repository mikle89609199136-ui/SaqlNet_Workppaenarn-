import { services } from '../../application/services/serviceContainer.js';

export const chatApi = {
  getChats() {
    return services.chatService.getChats();
  },

  getChat(chatId) {
    return services.chatService.getChat(chatId);
  },

  createChat(type, participants, title = '') {
    return services.chatService.createChat(type, participants, title);
  },

  updateChat(chatId, data) {
    return services.chatService.updateChat(chatId, data);
  },

  deleteChat(chatId) {
    return services.chatService.deleteChat(chatId);
  },

  muteChat(chatId, duration) {
    return services.chatService.muteChat(chatId, duration);
  },

  pinChat(chatId) {
    return services.chatService.pinChat(chatId);
  },

  archiveChat(chatId) {
    return services.chatService.archiveChat(chatId);
  },
};
