export const parseCallContent = (content) => {
  if (!content || typeof content !== "string") return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
};

export const formatCallDuration = (seconds) => {
  const total = Number(seconds) || 0;
  if (total <= 0) return "";
  const mins = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return mins ? `${mins}:${rest}` : `${total % 60} сек`;
};
