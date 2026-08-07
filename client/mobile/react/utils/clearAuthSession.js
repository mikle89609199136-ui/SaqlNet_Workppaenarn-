import { STORAGE_KEYS } from "../consts/storageKeys";
import { disconnectRealtimeSocket } from "../hooks/useRealtimeSocket";

export function clearAuthSession() {
  disconnectRealtimeSocket();
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER);
  localStorage.removeItem(STORAGE_KEYS.SETTINGS);
}