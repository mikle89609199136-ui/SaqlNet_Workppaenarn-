export function sortMessagesChronologically(messages) {
  return [...messages].sort(
    (left, right) => messageTime(left) - messageTime(right),
  );
}

function messageTime(message) {
  const value =
    message?.timestamp ??
    message?.createdAt ??
    message?.created_at ??
    message.pinnedAt;
  const time =
    value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}