import { useEffect } from "react";
import { STORAGE_KEYS } from "../../consts/storageKeys";
import { useRealtimeSocket } from "../../hooks/useRealtimeSocket";

export function NotificationManager() {
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
  const { eventBus } = useRealtimeSocket(!!token);

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    return eventBus.on("new_message", (payload) => {
      if (!document.hidden) return;
      if (Notification.permission !== "granted") return;
      const msg = payload?.message ?? payload ?? {};
      const title = msg.senderName || "CraneApp";
      const body =
        typeof msg.content === "string"
          ? msg.content.slice(0, 120)
          : "Новое сообщение";
      try {
        new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag: msg.chatId,
        });
      } catch (_) {}
    });
  }, [eventBus]);

  return null;
}
