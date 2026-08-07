export const hasMessageMedia = (msg) =>
  !!(msg.mediaUrl || msg.mediaUnavailable);

export const formatMessageTime = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
};

export function getMessagePreview(message) {
  if (!message) return "";
  return String(message.content || "").slice(0, 64);
}

export function appendUniqueMessage(items, nextMessage) {
  if (items.some((message) => message.id === nextMessage.id)) return items;
  return [...items, nextMessage];
}

export function updateMessage(items, messageId, patch) {
  return items.map((message) =>
    message.id === messageId ? { ...message, ...patch } : message,
  );
}

export function updatePinnedMessage(items, messageId, patch) {
  return items.map((item) =>
    item.message.id === messageId
      ? {
          ...item,
          message: {
            ...item.message,
            ...patch,
          },
        }
      : item,
  );
}

export function getMediaMessageType(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}
