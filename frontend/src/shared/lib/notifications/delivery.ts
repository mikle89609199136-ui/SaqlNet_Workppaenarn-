/** ОС получает background alerts; Web Audio используется только на переднем плане. */
export function appIsForeground(): boolean {
  return typeof document === 'undefined' || (!document.hidden && document.hasFocus());
}
export function activeChatIs(chatId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.location.pathname === `/chats/${encodeURIComponent(chatId)}`;
  } catch {
    return false;
  }
}
export function browserAlertsAllowed(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}
