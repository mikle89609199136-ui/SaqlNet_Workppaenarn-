import { services } from '../../application/services/serviceContainer.js';

export const messageApi = {
  getMessages(chatId, limit = 50, offset = 0) {
    return services.messageService.getMessages(chatId, limit, offset);
  },

  sendMessage(chatId, content, type = 'text', replyTo = null) {
    return services.messageService.sendMessage(chatId, content, type, replyTo);
  },

  editMessage(messageId, content) {
    return services.messageService.editMessage(messageId, content);
  },

  deleteMessage(messageId) {
    return services.messageService.deleteMessage(messageId);
  },

  markAsRead(chatId, messageIds) {
    return services.messageService.markAsRead(chatId, messageIds);
  },

  forwardMessage(messageId, chatId) {
    return services.messageService.forwardMessage(messageId, chatId);
  },

  pinMessage(messageId) {
    return services.messageService.pinMessage(messageId);
  },

  reactToMessage(messageId, emoji) {
    return services.messageService.reactToMessage(messageId, emoji);
  },
};
