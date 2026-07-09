const MAX_MESSAGE_LENGTH = 5000;

class MessageValidator {
  static validate(message) {
    const errors = [];
    const contentValidation = this.validateContent(message.content);

    if (!contentValidation.isValid) {
      errors.push(contentValidation.error);
    }

    if (!message.senderId) {
      errors.push('Sender ID is required');
    }

    if (!message.chatId) {
      errors.push('Chat ID is required');
    }

    return { isValid: errors.length === 0, errors };
  }

  static validateContent(content) {
    if (typeof content !== 'string') {
      return { isValid: false, error: 'Content must be a string' };
    }

    const trimmed = content.trim();

    if (!trimmed) {
      return { isValid: false, error: 'Content cannot be empty' };
    }

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { isValid: false, error: 'Content is too long' };
    }

    return { isValid: true };
  }
}

export default MessageValidator;
