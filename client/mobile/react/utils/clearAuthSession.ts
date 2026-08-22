import { disconnectRealtimeSocket } from "@/hooks";
import { useProfileStore } from "@/store";

export function clearAuthSession() {
  const { token, clearProfile } = useProfileStore.getState();
  if (!token) return;
  disconnectRealtimeSocket();
  clearProfile();
}