import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { EmptyChatListPlaceholder } from "../../components/components/EmptyChatsListPlaceholder.jsx";
import { UserProfilePanel } from "../../components/components/ProfilePanel/UserProfilePanel.jsx";
import { Identicon } from "../../components/ui/Identicon.jsx";
import { ChatsSkeleton } from "../../components/ui/Skeletons/ChatSkeleton.jsx";
import { ROUTES } from "../../consts/routes.js";
import { STORAGE_KEYS } from "../../consts/storageKeys.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useLocalStorage } from "../../hooks/useLocalStorage.js";
import { useRealtimeSocket } from "../../hooks/useRealtimeSocket.js";
import services from "../../services/serviceContainer.js";
import { useChatsStore } from "../../store/chats.js";
import { cn } from "../../utils/cn.js";

export function ChatsPage() {
  const chats = useChatsStore((state) => state.chats);
  const setChats = useChatsStore((state) => state.setChats);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser] = useLocalStorage(STORAGE_KEYS.USER, null);
  const typingTimeoutsRef = useRef(new Map());
  const { eventBus } = useRealtimeSocket(true);
  const navigate = useNavigate();
  const { chatId } = useParams();
  const isMobile = useIsMobile();
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [profileWidth, setProfileWidth] = useState(null);
  const [profileState, setProfileState] = useState({
    isOpen: false,
    isLoading: false,
    error: "",
    user: null,
    chat: null,
  });
  const [profileCloseToken, setProfileCloseToken] = useState(0);
  const { t } = useTranslation();

  useEffect(() => {
    let isMounted = true;

    services.chatService
      .getChats()
      .then((items) =>
        Promise.all(items.map((chat) => decryptChatPreview(chat))),
      )
      .then((items) => {
        if (!isMounted) return;
        setChats(items);
        setError("");
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(
          err.message || t("chatsLoadError", "Не удалось загрузить чаты"),
        );
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [t]);

  useEffect(() => {
    const updatePreview = async (payload) => {
      const incomingMessage = payload?.message ?? payload;
      const chatId = payload?.chatId ?? incomingMessage?.chatId;
      if (!chatId || !incomingMessage) return;

      const previewChat = await decryptChatPreview({
        id: chatId,
        lastMessage: {
          ...incomingMessage,
          chatId,
        },
      });

      setChats((items) => {
        const index = items.findIndex((chat) => chat.id === chatId);
        if (index === -1) return items;

        const nextChat = {
          ...items[index],
          typingUserId: null,
          lastMessage: previewChat.lastMessage,
          lastMessageAt:
            incomingMessage.createdAt ||
            incomingMessage.timestamp ||
            new Date().toISOString(),
        };
        window.clearTimeout(typingTimeoutsRef.current.get(chatId));
        typingTimeoutsRef.current.delete(chatId);
        const nextItems = [
          nextChat,
          ...items.slice(0, index),
          ...items.slice(index + 1),
        ];
        return nextItems;
      });
    };

    const handleTyping = (event) => {
      const chatId = event?.chatId;
      const userId = event?.userId || event?.senderId || event?.from;
      if (!chatId || !userId || userId === currentUser?.id) return;

      setChats((items) =>
        items.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                typingUserId: userId,
                peerIsOnline:
                  chat.type === "private" ? true : chat.peerIsOnline,
              }
            : chat,
        ),
      );

      window.clearTimeout(typingTimeoutsRef.current.get(chatId));
      typingTimeoutsRef.current.set(
        chatId,
        window.setTimeout(() => {
          setChats((items) =>
            items.map((chat) =>
              chat.id === chatId ? { ...chat, typingUserId: null } : chat,
            ),
          );
          typingTimeoutsRef.current.delete(chatId);
        }, 3000),
      );
    };

    const unsubscribeNew = eventBus.on("new_message", updatePreview);
    const unsubscribeEdited = eventBus.on("message:edited", updatePreview);
    const unsubscribeMessageEdited = eventBus.on("message_edited", updatePreview);
    const unsubscribeSent = eventBus.on("message:sent", updatePreview);
    const unsubscribeTyping = eventBus.on("typing", handleTyping);
    const unsubscribeUserTyping = eventBus.on("user_typing", handleTyping);
    const unsubscribeRead = eventBus.on("messages:read", ({ chatId }) => {
      setChats((items) =>
        items.map((chat) =>
          chat.id === chatId ? { ...chat, unreadCount: 0 } : chat,
        ),
      );
    });

    return () => {
      unsubscribeNew();
      unsubscribeEdited();
      unsubscribeMessageEdited();
      unsubscribeSent();
      unsubscribeTyping();
      unsubscribeUserTyping();
      unsubscribeRead();
      typingTimeoutsRef.current.forEach((timeoutId) =>
        window.clearTimeout(timeoutId),
      );
      typingTimeoutsRef.current.clear();
    };
  }, [currentUser?.id, eventBus]);

  // --- новое: ресайз, перенесён из ChatLayout без изменений ---
  function startResize(kind, event) {
    event.preventDefault();
    const startX = event.clientX;
    const startSidebarWidth = sidebarWidth;
    const startProfileWidth =
      profileWidth || Math.round(window.innerWidth * 0.25);

    function handleMove(moveEvent) {
      if (kind === "sidebar") {
        const nextWidth = Math.min(
          Math.max(startSidebarWidth + moveEvent.clientX - startX, 280),
          520,
        );
        setSidebarWidth(nextWidth);
      } else {
        const nextWidth = Math.min(
          Math.max(startProfileWidth - (moveEvent.clientX - startX), 300),
          560,
        );
        setProfileWidth(nextWidth);
      }
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  const listContent = (
    <>
      <section className="chats-toolbar">
        <Link
          className="chats-search"
          to="/contacts"
          aria-label={t("search", "Поиск чатов и людей...")}
        >
          <span className="chats-search-placeholder">
            {t("search", "Поиск чатов и людей...")}
          </span>
        </Link>
      </section>

      <section className="chats-list" aria-busy={isLoading}>
        {isLoading ? <ChatsSkeleton /> : null}
        {!isLoading && error && (
          <ErrorChatListPlaceholder
            message={error}
            onRetry={() => window.location.reload()}
          />
        )}
        {!isLoading && !error && chats.length === 0 && (
          <EmptyChatListPlaceholder />
        )}
        {!isLoading &&
          !error &&
          chats.map((chat) => <ChatListItem chat={chat} key={chat.id} />)}
      </section>
    </>
  );

  // Мобильный экран: если чат выбран — на весь экран рендерится Outlet (ChatThreadPage),
  // список чатов при этом не рендерится вообще. Если не выбран — список на весь экран,
  // Outlet (заглушка) не рендерим — на мобиле заглушка не нужна.
  if (isMobile) {
    if (chatId) {
      return (
        <Outlet
          context={{
            onProfileStateChange: setProfileState,
            profileCloseToken,
            profileMode: "modal",
          }}
        />
      );
    }
    return <main className="chats-page">{listContent}</main>;
  }

  // Десктоп: список слева (ресайзабельный) + Outlet справа (тред или заглушка) +
  // опциональная панель профиля, которую открывает сам ChatThreadPage через context.
  return (
    <div
      className={`chat-workspace ${profileState.isOpen ? "has-profile" : ""}`}
    >
      <div className="app-sidebar-pane" style={{ flexBasis: sidebarWidth }}>
        <main className="chats-page">{listContent}</main>
      </div>

      <div
        aria-label="Изменить ширину списка чатов"
        className="app-pane-resizer app-pane-resizer-sidebar"
        onPointerDown={(event) => startResize("sidebar", event)}
        role="separator"
      />

      <div className="app-chat-pane">
        <Outlet
          context={{
            onProfileStateChange: setProfileState,
            profileCloseToken,
            profileMode: "panel",
          }}
        />
      </div>

      {profileState.isOpen && (
        <>
          <div
            aria-label="Изменить ширину профиля"
            className="app-pane-resizer app-pane-resizer-profile"
            onPointerDown={(event) => startResize("profile", event)}
            role="separator"
          />
          <div
            className="app-profile-pane"
            style={profileWidth ? { flexBasis: profileWidth } : undefined}
          >
            <UserProfilePanel
              onClose={() => {
                setProfileState({
                  isOpen: false,
                  isLoading: false,
                  error: "",
                  user: null,
                  chat: null,
                });
                setProfileCloseToken((value) => value + 1);
              }}
              profileState={profileState}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ChatListItem({ chat }) {
  const { t } = useTranslation();
  const title = chat.name || t("untitledChat", "Без названия");
  const lastMessage = chat.typingUserId
    ? t("typing", "печатает...")
    : getLastMessageText(chat, t);

  const peerId = chat.peerId ?? chat.peer_id ?? null;
  const isPeerOnline = Boolean(
    chat.type === "private" && (chat.peerIsOnline || chat.typingUserId),
  );

  return (
    <Link
      className="chat-row"
      to={ROUTES.CHAT_BY_ID(chat.id)}
      aria-label={title}
    >
      <div
        className={cn(
          "chat-avatar",
          `chat-avatar-${chat.type || "private"}`,
          isPeerOnline && "is-online",
        )}
        style={peerId ? { background: "none", padding: 0 } : {}}
      >
        {peerId ? (
          <Identicon userId={peerId} size={48} />
        ) : (
          title.slice(0, 1).toUpperCase()
        )}
      </div>
      <div className="chat-main">
        <div className="chat-topline">
          <span className="chat-title">{title}</span>
          <span className="chat-time">
            {formatChatTime(
              chat.lastMessage?.createdAt ||
                chat.lastMessageAt ||
                chat.createdAt,
            )}
          </span>
        </div>
        <div className="chat-subline">
          <span>{lastMessage}</span>
          {chat.unreadCount > 0 ? (
            <strong className="chat-unread">{chat.unreadCount}</strong>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

async function decryptChatPreview(chat) {
  if (!chat?.id || !chat.lastMessage || typeof chat.lastMessage === "string") {
    return chat;
  }

  if (chat.lastMessage.type === "call") {
    return {
      ...chat,
      lastMessage: {
        ...chat.lastMessage,
        content: formatCallPreview(chat.lastMessage.content),
      },
    };
  }

  try {
    const message = await services.messageService.processMessageForDisplay(
      chat.id,
      {
        ...chat.lastMessage,
        chatId: chat.lastMessage.chatId ?? chat.id,
      },
    );
    return {
      ...chat,
      lastMessage: {
        ...chat.lastMessage,
        content: message.content,
      },
    };
  } catch (error) {
    console.warn("Failed to decrypt chat preview", error);
    return chat;
  }
}

function formatCallPreview(content) {
  if (!content || typeof content !== "string") return "Звонок завершен";
  try {
    const parsed = JSON.parse(content);
    const duration = Number(parsed?.duration) || 0;
    if (duration > 0) {
      return `Звонок завершен · ${formatCallDuration(duration)}`;
    }
  } catch (_) {
    // Ignore malformed legacy payloads and show a friendly fallback.
  }
  return "Звонок завершен";
}

function formatCallDuration(seconds) {
  const total = Number(seconds) || 0;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest} сек`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function getLastMessageText(chat, t) {
  if (typeof chat.lastMessage === "string")
    return chat.lastMessage || t("noMessages", "Нет сообщений");
  if (chat.lastMessage?.content) return chat.lastMessage.content;
  if (chat.lastMessageEncrypted)
    return t("encryptedMessage", "Зашифрованное сообщение");
  return t("noMessages", "Нет сообщений");
}

function formatChatTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
