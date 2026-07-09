class SendMessage {
  constructor(messageService) {
    this.messageService = messageService;
  }

  execute({ chatId, content, type = 'text', replyTo = null }) {
    return this.messageService.sendMessage(chatId, content, type, replyTo);
  }
}

export default SendMessage;
