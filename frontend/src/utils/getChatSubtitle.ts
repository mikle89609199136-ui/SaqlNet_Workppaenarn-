import { formatLastSeen } from "./formatLastSeen";

/**
 * Генерирует подзаголовок для чата (статус онлайн / печатает / последнее посещение)
 */
export const getChatSubtitle = (chat, typingUserId, t) => {
  if (typingUserId) return t("typing", "печатает...");
  if (chat?.type === "group") return t("groupChat", "Группа");
  if (chat?.peerIsOnline) return t("online", "онлайн");

  return chat?.peerLastSeen
    ? formatLastSeen(chat.peerLastSeen, t)
    : t("lastSeenRecently", "был(а) недавно");
};
