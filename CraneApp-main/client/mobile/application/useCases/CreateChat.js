class CreateChat {
  constructor(chatService) {
    this.chatService = chatService;
  }

  execute({ type, participants, title = '' }) {
    return this.chatService.createChat(type, participants, title);
  }
}

export default CreateChat;
