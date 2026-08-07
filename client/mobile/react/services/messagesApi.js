import services from "./serviceContainer";

export const getMessages = async ({ chatId, offset = 0 }) => {
  const response = await services.messageService.getMessages(chatId, offset);

  return response;
};
