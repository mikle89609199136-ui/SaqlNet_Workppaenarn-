import { services } from "@/services";

export const getMessages = async ({
  chatId,
  offset = 0,
}: {
  chatId: string;
  offset: number;
}) => {
  const response = await services.messageService.getMessages(chatId, offset);

  return response;
};
