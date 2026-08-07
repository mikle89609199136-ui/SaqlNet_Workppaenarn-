import {
  Link,
  useLoaderData,
  useOutletContext,
  useParams,
} from "react-router-dom";
import Message from "../../../domain/entities/Message.js";
import { ForwardChatMessagesModal } from "../../components//ForwardChatMessagesModal.jsx";
import { GroupInfoModal } from "../../components/Chats/GroupInfoModal.jsx";
import { MessageBubble } from "../../components/components/MessageBubble/MessageBubble.jsx";
import { MessageActionsPopover } from "../../components/components/Modals/MessageActionsPopover.jsx";
import { PinnedMessages } from "../../components/components/PinnedMessages.jsx";
import { PhotoEditorModal } from "../../components/media-editor/PhotoEditorModal.jsx";
import { Identicon } from "../../components/ui/Identicon.jsx";
import { ThreadSkeleton } from "../../components/ui/Skeletons/ThreadSkeleton.jsx";
import { useRealtimeSocket } from "../../hooks/useRealtimeSocket.js";
import services from "../../services/serviceContainer.js";
import { useChatStore } from "../../store/chat.js";
import "../../styles/ChatThreadPage.css";

import { useTranslation } from "react-i18next";
import { UserProfileModal } from "../../components/components/Modals/UserProfileModal.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { ThreadState } from "../../components/ui/ThreadState.jsx";
import { STORAGE_KEYS } from "../../consts/storageKeys.js";
import { useCall } from "../../hooks/useCall.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useLocalStorage } from "../../hooks/useLocalStorage.js";
import { useMessageActions } from "../../hooks/useMessageActions.js";
import { getMessages } from "../../services/messagesApi.js";
import { formatFileSize } from "../../utils/formatFileSize.js";
import { getAttachmentIcon } from "../../utils/getAttachmentIcon.js";
import { getChatSubtitle } from "../../utils/getChatSubtitle.js";
import {
  appendUniqueMessage,
  getMediaMessageType,
  getMessagePreview,
  updateMessage,
  updatePinnedMessage,
} from "../../utils/message.js";
import { PinnedMessagesPage } from "../PinnedMessagesPage/PinnedMessagesPage.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLOSING } from "ws";

export function ChatThreadPage() {
  const { chatId } = useParams();
  const { onProfileStateChange, profileCloseToken, profileMode } =
    useOutletContext();
  const { t } = useTranslation();
  const {
    chat,
    setChat,
    messages,
    setMessages,
    error,
    setError,
    editingMessage,
    setEditingMessage,
    draft,
    setDraft,
    replyToMessage,
    setReplyToMessage,
    selectedMessages,
    setSelectedMessages,
    pinnedMessages,
    setPinnedMessages,
    selectionMode,
    setSelectionMode,
    translations,
    setTranslations,
    actionMenu,
    setActionMenu,
    resetChatState,
  } = useChatStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [photoEditorFile, setPhotoEditorFile] = useState(null);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [openedImage, setOpenedImage] = useState(null);
  const [typingUserId, setTypingUserId] = useState(null);
  const [profileModal, setProfileModal] = useState({
    isOpen: false,
    isLoading: false,
    error: "",
    user: null,
  });
  const [isPinnedMessagesOpen, setPinnedMessagesOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const [showCallMenu, setShowCallMenu] = useState(false);
  const [currentUser] = useLocalStorage(STORAGE_KEYS.USER, null);
  const bottomRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const lastTypingSentAtRef = useRef(0);
  const typingTimeoutRef = useRef(null);
  const draftRef = useRef(null);
  const timerRef = useRef(null);
  const isLongPress = useRef(false);
  const messagesRef = useRef(null);
  const chatIdRef = useRef(chatId);

  const { eventBus, socket } = useRealtimeSocket(Boolean(chatId));
  const { initiateCall } = useCall();
  const { loadedChat, loadedMessages, loadedPinnedMessages } = useLoaderData();
  const isMobile = useIsMobile();

  const {
    handleCancelSelection,
    runMessageAction,
    handleCopyMessage,
    handleDelete,
    handleForward,
    handleCloseForwardModal,
    handleUnpinMessage
  } = useMessageActions({
    currentUser,
    chatId,
    chatType: chat?.type,
    chatRole: chat?.role,
    draftRef,
    setIsForwardModalOpen,
    updateMessage,
  });

  const handleTouchStart = () => {
    isLongPress.current = false;
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      setShowCallMenu((prev) => !prev);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const handleCallClick = () => {
    if (isLongPress.current) return;
    if (showCallMenu) {
      setShowCallMenu(false);
      return;
    }
    initiateCall(chatId, chat?.type, title, "audio");
  };

  const loadMoreMessages = useCallback(async () => {
    const requestChatId = chatId;
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);

    const container = messagesRef.current;
    const prevHeight = container.scrollHeight;

    const nextOffset = offset + 50;

    const olderMessages = await getMessages({ chatId, offset: nextOffset });

    if (chatIdRef.current !== requestChatId) {
      return;
    }

    if (olderMessages.length < 50) {
      setHasMore(false);
    }

    setMessages((prev) => [...olderMessages, ...prev]);
    setOffset(nextOffset);

    requestAnimationFrame(() => {
      container.scrollTop += container.scrollHeight - prevHeight;
    });

    setIsLoadingMore(false);
  }, [chatId, offset, hasMore, isLoadingMore]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;

    const onScroll = () => {
      const hasOverflow = container.scrollHeight > container.clientHeight;
      if (hasOverflow && container.scrollTop <= 50) {
        loadMoreMessages();
      }
    };

    container.addEventListener("scroll", onScroll);

    return () => container.removeEventListener("scroll", onScroll);
  }, [loadMoreMessages]);

  useEffect(() => {
    if (profileMode !== "panel" || typeof onProfileStateChange !== "function")
      return;
    onProfileStateChange({ ...profileModal, chat, messages });
  }, [chat, messages, onProfileStateChange, profileMode, profileModal]);

  useEffect(() => {
    setProfileModal({ isOpen: false, isLoading: false, error: "", user: null });
  }, [chatId]);

  useEffect(() => {
    if (profileCloseToken === 0) return;
    setProfileModal({ isOpen: false, isLoading: false, error: "", user: null });
  }, [profileCloseToken]);

  useEffect(() => {
    if (!selectionMode) return;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") handleCancelSelection();
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectionMode]);

  useEffect(() => {
    if (!actionMenu) return undefined;

    const closeActionMenu = () => setActionMenu(null);
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeActionMenu();
    };

    window.addEventListener("click", closeActionMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeActionMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionMenu]);

  useEffect(() => {
    if (!openedImage) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpenedImage(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [openedImage]);

  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    setIsLoadingMore(false);
  }, [chatId]);

  useEffect(() => {
    resetChatState();
    setChat(loadedChat);
    setMessages(loadedMessages);
    setPinnedMessages(loadedPinnedMessages);
    markMessagesAsRead(chatId, loadedMessages);
    setIsLoading(false);
  }, [loadedChat, loadedMessages, loadedPinnedMessages]);

  useEffect(() => {
    if (isLoading) return;

    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({
        block: "end",
        behavior: "auto",
      });
    });
  }, [chatId, isLoading]);

  useEffect(() => {
    const unsubscribeNew = eventBus.on("new_message", async (event) => {
      if (event.chatId !== chatId || !event.message) return;
      const nextMessage =
        typeof services.messageService.processMessageForDisplay === "function"
          ? await services.messageService.processMessageForDisplay(
            chatId,
            event.message,
          )
          : Message.fromAPI(event.message);
      services.messageService.addMessageToCache(chatId, nextMessage);
      setMessages((items) => appendUniqueMessage(items, nextMessage));
      markMessagesAsRead(chatId, [nextMessage]);
    });

    const unsubscribeEdited = eventBus.on("message_edited", (event) => {
      setMessages((items) =>
        items.map((message) =>
          message.id === event.messageId
            ? {
              ...message,
              content: event.content,
              editedAt: event.editedAt,
              isEdited: true,
            }
            : message,
        ),
      );
      setPinnedMessages((items) =>
        updatePinnedMessage(items, event.messageId, {
          content: event.content,
          editedAt: event.editedAt,
          isEdited: true,
        }),
      );
    });

    const unsubscribeDeleted = eventBus.on("message_deleted", (event) => {
      if (event.chatId && event.chatId !== chatId) return;
      setMessages((items) =>
        items.filter((message) => message.id !== event.messageId),
      );
    });

    const handleTyping = (event) => {
      if (event.chatId !== chatId) return;
      const userId = event.userId || event.senderId || event.from;
      if (!userId || userId === currentUser?.id) return;

      setTypingUserId(userId);
      setChat((currentChat) =>
        currentChat?.type === "private"
          ? { ...currentChat, peerIsOnline: true }
          : currentChat,
      );
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = window.setTimeout(() => {
        setTypingUserId(null);
      }, 3000);
    };
    const unsubscribeTyping = eventBus.on("typing", handleTyping);
    const unsubscribeUserTyping = eventBus.on("user_typing", handleTyping);
    const unsubscribePinned = eventBus.on("message_pinned", async (event) => {
      if (event.chatId && event.chatId !== chatId) return;

      const message = await services.messageService.processMessageForDisplay(chatId, event.pin.message)
      const pinned = { ...event.pin, message }
      setPinnedMessages((prev) => [...prev, pinned]);
      services.messageService.addPinnedMessageToCache(chatId, pinned)
    });
    const unsubscribeUnpinned = eventBus.on("message_unpinned", (event) => {
      if (event.chatId && event.chatId !== chatId) return;
      setPinnedMessages((items) =>
        items.filter((item) => item.messageId !== event.messageId),
      );
      services.messageService.removePinnedMessageFromCache(event.messageId)
    });

    return () => {
      unsubscribeNew();
      unsubscribeEdited();
      unsubscribeDeleted();
      unsubscribeTyping();
      unsubscribeUserTyping();
      unsubscribePinned();
      unsubscribeUnpinned();
      window.clearTimeout(typingTimeoutRef.current);
    };
  }, [chatId, currentUser?.id, eventBus]);

  useEffect(() => {
    window.addEventListener("keydown", handleComposerKeyDown);

    return () => {
      window.removeEventListener("keydown", handleComposerKeyDown);
    };
  }, [draft, editingMessage, replyToMessage, messages, currentUser?.id]);

  function markMessagesAsRead(targetChatId, nextMessages) {
    const messageIds = nextMessages
      .filter((message) => message?.id && message.senderId !== currentUser?.id)
      .map((message) => message.id);
    if (
      messageIds.length === 0 ||
      typeof services.messageService.markAsRead !== "function"
    )
      return;
    services.messageService
      .markAsRead(targetChatId, messageIds)
      .catch((err) => {
        console.warn("Failed to mark messages as read", err);
      });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (selectionMode) return;
    const content = draft.trim();
    if ((!content && !pendingAttachment) || isSending) return;

    setIsSending(true);
    try {
      if (editingMessage) {
        const result = await services.messageService.editMessage(
          editingMessage.id,
          content,
        );
        setMessages((items) =>
          updateMessage(items, editingMessage.id, {
            content: result.content,
            editedAt: result.editedAt,
            isEdited: true,
          }),
        );
        setPinnedMessages((items) =>
          updatePinnedMessage(items, editingMessage.id, {
            content: result.content,
            editedAt: result.editedAt,
            isEdited: true,
          }),
        );
        setEditingMessage(null);
      } else if (pendingAttachment) {
        const message = await services.messageService.sendMediaMessage(
          chatId,
          pendingAttachment.file,
          pendingAttachment.type,
          content,
          replyToMessage?.id,
        );
        setMessages((items) => appendUniqueMessage(items, message));
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({
            behavior: "smooth",
          });
        });
        setPendingAttachment(null);
        setReplyToMessage(null);
        if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      } else {
        const message = await services.messageService.sendMessage(
          chatId,
          content,
          "text",
          replyToMessage?.id,
        );
        setMessages((items) => appendUniqueMessage(items, message));
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({
            behavior: "smooth",
          });
        });
        setReplyToMessage(null);
      }
      setDraft("");
      setError("");
    } catch (err) {
      setError(
        err.message || t("messageSendError", "Не удалось отправить сообщение"),
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleAttachmentChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      setError(
        t(
          "attachmentTooLarge",
          "Файл слишком большой. Максимальный размер — 100 МБ.",
        ),
      );
      event.target.value = "";
      return;
    }

    if (file.type.startsWith("image/")) {
      setPhotoEditorFile(file);
      setEditingMessage(null);
      setError("");
      return;
    }

    setPendingAttachment({
      file,
      type: getMediaMessageType(file.type),
    });
    setEditingMessage(null);
    setError("");
  }

  function closePhotoEditor() {
    setPhotoEditorFile(null);

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }

  function handlePhotoEditorSave(file) {
    setPendingAttachment({
      file,
      type: "image",
    });

    setPhotoEditorFile(null);
    setEditingMessage(null);
    setError("");

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }

  function removePendingAttachment() {
    setPendingAttachment(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  function handleDraftChange(event) {
    setDraft(event.target.value);
    sendTyping();
  }

  function handleComposerKeyDown(event) {
    if (event.key === "Escape" && (editingMessage || replyToMessage)) {
      event.preventDefault();
      cancelComposerMode();
      return;
    }

    if (
      event.key !== "ArrowUp" ||
      draft.trim() ||
      editingMessage ||
      replyToMessage
    )
      return;
    const lastOwnMessage = [...messages]
      .reverse()
      .find(
        (message) => message.senderId === currentUser?.id && !message.deletedAt,
      );
    if (!lastOwnMessage) return;

    event.preventDefault();
    startEdit(lastOwnMessage);
  }

  function sendTyping() {
    if (!chatId || !socket?.isConnected) return;

    const now = Date.now();
    if (now - lastTypingSentAtRef.current < 1500) return;
    lastTypingSentAtRef.current = now;

    try {
      socket.send({ type: "typing", chatId, userId: currentUser?.id });
    } catch (err) {
      console.warn("Failed to send typing event", err);
    }
  }

  function startEdit(message) {
    setEditingMessage(message);
    setReplyToMessage(null);
    setDraft(message.content || "");
    draftRef.current.focus();
  }

  function cancelComposerMode() {
    setEditingMessage(null);
    setReplyToMessage(null);
    setDraft("");
  }

  async function openChatProfile() {
    if (chat?.type === "group") {
      setIsGroupInfoOpen(true);
      return;
    }
    if (chat?.type !== "private" || !chat.peerId) return;

    setProfileModal({ isOpen: true, isLoading: true, error: "", user: null });
    try {
      const profile = await services.userService.getProfile(chat.peerId);
      setProfileModal({
        isOpen: true,
        isLoading: false,
        error: "",
        user: profile,
      });
    } catch (err) {
      setProfileModal({
        isOpen: true,
        isLoading: false,
        error:
          err.message || t("profileLoadError", "Не удалось загрузить профиль"),
        user: null,
      });
    }
  }

  function toggleMessageSelection(message) {
    setSelectedMessages((messages) => {
      const isMessageSelected = messages.find(({ id }) => id === message.id);

      if (isMessageSelected) {
        const next = messages.filter(({ id }) => id !== message.id);

        if (next.length === 0) {
          setSelectionMode(false);
        }

        return next;
      }

      return [...messages, message];
    });
  }

  const title = chat?.name || chat?.title || t("chat", "Чат");
  const subtitle = getChatSubtitle(chat, typingUserId, t);
  const isPeerOnline = Boolean(chat?.type === "private" && chat?.peerIsOnline);
  const peerAvatarUrl = chat?.avatarUrl || "";
  const selectedActionMessage = actionMenu
    ? messages.find((message) => message.id === actionMenu.messageId)
    : null;

  return (
    <>
      {isForwardModalOpen && (
        <ForwardChatMessagesModal
          messages={selectedMessages}
          onClose={handleCloseForwardModal}
          setSelectedMessages={setSelectedMessages}
          setSelectionMode={setSelectionMode}
        />
      )}
      {isPinnedMessagesOpen && (
        <PinnedMessagesPage
          pinnedMessages={pinnedMessages}
          onClose={() => setPinnedMessagesOpen(false)}
          isLoading={isLoading}
          error={error}
          openedImage={openedImage}
          onOpenImage={(url) => setOpenedImage(url)}
          onSelection={toggleMessageSelection}
          actionMenu={actionMenu}
          currentUser={currentUser}
          setIsForwardModalOpen={setIsForwardModalOpen}
          ref={draftRef}
          updateMessage={updateMessage}
          handleUnpinMessage={handleUnpinMessage}
          setPinnedMessagesOpen={setPinnedMessagesOpen}
        />
      )}
      {!isPinnedMessagesOpen && (
        <main className="thread-page">
          <header className="thread-header">
            {/* Левый блок: аватар и информация о чате */}
            <Link
              aria-label={t("back", "Назад")}
              className="thread-back"
              to="/chats"
            >
              <svg
                fill="none"
                height="27"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                viewBox="3 0 20 22"
                width="27"
              >
                <line x1="19" x2="5" y1="12" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </Link>

            <div
              className="thread-header-card thread-header-info"
              onClick={openChatProfile}
              style={{
                cursor:
                  chat?.type === "group" || chat?.type === "private"
                    ? "pointer"
                    : "default",
              }}
            >
              <button
                aria-label={title}
                className={`thread-avatar ${isPeerOnline ? "is-online" : ""}`}
                tabIndex={-1}
                type="button"
              >
                {peerAvatarUrl ? (
                  <img alt="" src={peerAvatarUrl} />
                ) : chat?.type === "private" && chat?.peerId ? (
                  <Identicon size={50} userId={chat.peerId} />
                ) : (
                  title.slice(0, 1).toUpperCase()
                )}
              </button>

              <div className="thread-title-wrap">
                <h1>{title}</h1>
                <p>{subtitle}</p>
              </div>
            </div>

            {/* Правый блок: кнопки звонков */}
            <div className="thread-call-actions-wrap">
              {/* Десктопная версия */}
              <div className="thread-header-card thread-call-actions thread-call-desktop">
                <button
                  className="thread-call-button"
                  onClick={() =>
                    initiateCall(
                      chatId,
                      chat?.type,
                      title,
                      "audio",
                      chat?.peerId,
                    )
                  }
                  title={t("audioCall", "Аудиозвонок")}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="thread-call-icon"
                    height="24"
                    viewBox="0 0 24 24"
                    width="24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g fill="none">
                      <path d="M0 0h24v24H0z" />
                      <path
                        d="M4.477 4.116c-2.924 3.217-1.362 8.196 2.932 12.51 4.204 4.222 9.407 5.8 12.486 2.936 1.685-1.567 1.436-4.343-.645-6.198l-.19-.161c-1.931-1.563-4.734-1.568-6.445-.027l-.088.082-.05-.042c-.187-.16-.43-.381-.724-.673l-.298-.303-.306-.326q-.138-.152-.246-.277l-.124-.147-.07.075c1.69-1.697 1.706-4.72.006-6.75-1.887-2.255-4.75-2.335-6.238-.699M9.335 5.97c1.18 1.41 1.049 3.371.099 4.325l-.148.14c-.63.567-1.246.901 1.032 3.218 2.458 2.499 2.765 1.622 3.405.952 1.006-1.01 2.975-1.104 4.329.103 1.497 1.334 1.335 2.868.617 3.536-2.222 2.067-6.476.636-9.984-2.888S3.621 7.734 5.81 5.326c.508-.558 2.101-1.057 3.526.644"
                        fill="currentColor"
                      />
                    </g>
                  </svg>
                </button>

                <button
                  className="thread-call-button"
                  onClick={() =>
                    initiateCall(
                      chatId,
                      chat?.type,
                      title,
                      "video",
                      chat?.peerId,
                    )
                  }
                  title={t("videoCall", "Видео")}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="thread-call-icon thread-call-icon-video"
                    height="24"
                    viewBox="0 0 24 24"
                    width="24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g fill="none">
                      <path d="M0 0h24v24H0z" />
                      <path
                        clipRule="evenodd"
                        d="M6.5 5.75A3.5 3.5 0 0 0 3 9.25v5.5a3.5 3.5 0 0 0 3.5 3.5h7a3.5 3.5 0 0 0 3.5-3.5v-.52l2.65 2.07A1.45 1.45 0 0 0 22 15.15v-6.3a1.45 1.45 0 0 0-2.35-1.15L17 9.77v-.52a3.5 3.5 0 0 0-3.5-3.5h-7Zm-1.7 3.5A1.7 1.7 0 0 1 6.5 7.55h7a1.7 1.7 0 0 1 1.7 1.7v5.5a1.7 1.7 0 0 1-1.7 1.7h-7a1.7 1.7 0 0 1-1.7-1.7v-5.5Zm12.2 2.8 3.2 2.5v-5.1L17 11.95v.1Z"
                        fill="currentColor"
                        fillRule="evenodd"
                      />
                    </g>
                  </svg>
                </button>
              </div>

              {/* Мобильная версия */}
              <div className="thread-header-card thread-call-mobile">
                <button
                  className="thread-call-button"
                  onClick={handleCallClick}
                  onMouseDown={handleTouchStart}
                  onMouseUp={handleTouchEnd}
                  onTouchEnd={handleTouchEnd}
                  onTouchStart={handleTouchStart}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="thread-call-icon"
                    height="22"
                    viewBox="0 0 24 24"
                    width="22"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g fill="none">
                      <path d="M0 0h24v24H0z" />
                      <path
                        d="M4.477 4.116c-2.924 3.217-1.362 8.196 2.932 12.51 4.204 4.222 9.407 5.8 12.486 2.936 1.685-1.567 1.436-4.343-.645-6.198l-.19-.161c-1.931-1.563-4.734-1.568-6.445-.027l-.088.082-.05-.042c-.187-.16-.43-.381-.724-.673l-.298-.303-.306-.326q-.138-.152-.246-.277l-.124-.147-.07.075c1.69-1.697 1.706-4.72.006-6.75-1.887-2.255-4.75-2.335-6.238-.699M9.335 5.97c1.18 1.41 1.049 3.371.099 4.325l-.148.14c-.63.567-1.246.901 1.032 3.218 2.458 2.499 2.765 1.622 3.405.952 1.006-1.01 2.975-1.104 4.329.103 1.497 1.334 1.335 2.868.617 3.536-2.222 2.067-6.476.636-9.984-2.888S3.621 7.734 5.81 5.326c.508-.558 2.101-1.057 3.526.644"
                        fill="currentColor"
                      />
                    </g>
                  </svg>
                </button>

                {showCallMenu ? (
                  <div className="thread-call-menu">
                    <button
                      onClick={() => {
                        setShowCallMenu(false);
                        initiateCall(
                          chatId,
                          chat?.type,
                          title,
                          "audio",
                          chat?.peerId,
                        );
                      }}
                      type="button"
                    >
                      <svg
                        fill="currentColor"
                        height="18"
                        viewBox="0 0 24 24"
                        width="18"
                      >
                        <path d="M6.62 10.79a15.053 15.053 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                      </svg>
                      {t("audioCall", "Аудио")}
                    </button>

                    <button
                      onClick={() => {
                        setShowCallMenu(false);
                        initiateCall(
                          chatId,
                          chat?.type,
                          title,
                          "video",
                          chat?.peerId,
                        );
                      }}
                      type="button"
                    >
                      <svg
                        fill="currentColor"
                        height="18"
                        viewBox="0 0 24 24"
                        width="18"
                      >
                        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                      </svg>
                      {t("videoCall", "Видео")}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <PinnedMessages
            messages={pinnedMessages}
            setPinnedMessagesOpen={setPinnedMessagesOpen}
          />

          <section
            className="thread-messages"
            aria-busy={isLoading}
            ref={messagesRef}
          >
            {isLoading && <ThreadSkeleton />}
            {!isLoading && error && messages.length === 0 && (
              <ThreadState
                message={error}
                title={t("loadingError", "Ошибка загрузки")}
              />
            )}
            {!isLoading && !error && messages.length === 0 && (
              <ThreadState
                message={t(
                  "emptyThreadDescription",
                  "Напишите первое сообщение в этом чате.",
                )}
                title={t("emptyThread", "Сообщений пока нет")}
              />
            )}
            {messages.map((message) => (
              <MessageBubble
                currentUserId={currentUser?.id}
                key={message.id}
                message={message}
                translations={translations}
                onOpenImage={(url) => setOpenedImage(url)}
                onSelection={toggleMessageSelection}
              />
            ))}
            <div ref={bottomRef} />
          </section>

          {actionMenu && selectedActionMessage && (
            <>
              <div aria-hidden="true" className="message-actions-backdrop" />
              <MessageActionsPopover
                message={selectedActionMessage}
                onSelection={toggleMessageSelection}
                currentUser={currentUser}
                draftRef={draftRef}
                chatId={chatId}
                chatType={chat?.type}
                chatRole={chat?.role}
                updateMessage={updateMessage}
                setIsForwardModalOpen={setIsForwardModalOpen}
              />
            </>
          )}

          {openedImage && (
            <div
              aria-label={t("imageViewer", "Просмотр изображения")}
              aria-modal="true"
              className="image-viewer"
              onClick={() => setOpenedImage(null)}
              role="dialog"
            >
              <button
                aria-label={t("close", "Закрыть")}
                className="image-viewer-close"
                onClick={() => setOpenedImage(null)}
                type="button"
              >
                ×
              </button>
              <img
                alt=""
                onClick={(event) => event.stopPropagation()}
                src={openedImage}
              />
            </div>
          )}

          <form className="thread-composer" onSubmit={handleSubmit}>
            <div className="thread-composer-card">
              {editingMessage || replyToMessage ? (
                <div className="thread-composer-context">
                  <span>
                    {editingMessage
                      ? t("editingMessage", "Редактирование")
                      : `${t("replyTo", "Ответ")}: ${getMessagePreview(replyToMessage)}`}
                  </span>

                  <button
                    aria-label={t("cancel", "Отменить")}
                    className="thread-composer-close-btn"
                    onClick={cancelComposerMode}
                    type="button"
                  >
                    <svg
                      fill="none"
                      height="14"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      viewBox="0 0 24 24"
                      width="14"
                    >
                      <line x1="18" x2="6" y1="6" y2="18" />
                      <line x1="6" x2="18" y1="6" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : null}

              {pendingAttachment && (
                <div className="thread-attachment-preview">
                  <span aria-hidden="true">
                    {getAttachmentIcon(pendingAttachment.type)}
                  </span>

                  <span title={pendingAttachment.file.name}>
                    {pendingAttachment.file.name}
                  </span>

                  <small>{formatFileSize(pendingAttachment.file.size)}</small>

                  <button
                    aria-label={t("removeAttachment", "Убрать вложение")}
                    className="thread-composer-close-btn"
                    onClick={removePendingAttachment}
                    type="button"
                  >
                    <svg
                      fill="none"
                      height="14"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      viewBox="0 0 24 24"
                      width="14"
                    >
                      <line x1="18" x2="6" y1="6" y2="18" />
                      <line x1="6" x2="18" y1="6" y2="18" />
                    </svg>
                  </button>
                </div>
              )}

              {!selectionMode && (
                <div className="thread-composer-row">
                  <input
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
                    aria-label={t("attachFile", "Прикрепить файл")}
                    className="thread-file-input"
                    onChange={handleAttachmentChange}
                    ref={attachmentInputRef}
                    type="file"
                  />

                  <button
                    aria-label={t("attachFile", "Прикрепить файл")}
                    className="thread-composer-action-btn thread-attach-button"
                    disabled={isSending || Boolean(editingMessage)}
                    onClick={() => attachmentInputRef.current?.click()}
                    type="button"
                  >
                    <svg
                      fill="none"
                      height="22"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="22"
                    >
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>

                  <input
                    ref={draftRef}
                    aria-label={t("message", "Сообщение")}
                    className="thread-composer-input"
                    onChange={handleDraftChange}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={t("messagePlaceholder", "Сообщение...")}
                    value={draft}
                  />

                  <button
                    aria-label={t("emoji", "Смайлики")}
                    className="thread-composer-action-btn"
                    type="button"
                  >
                    <svg
                      fill="none"
                      height="22"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="22"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      <line x1="9" x2="9.01" y1="9" y2="9" />
                      <line x1="15" x2="15.01" y1="9" y2="9" />
                    </svg>
                  </button>

                  <div className="thread-composer-submit-wrap">
                    <button
                      className={`thread-composer-action-btn thread-send-btn ${draft.trim() || pendingAttachment ? "is-visible" : ""
                        }`}
                      disabled={
                        (!draft.trim() && !pendingAttachment) || isSending
                      }
                      type="submit"
                    >
                      {isSending ? (
                        <span className="thread-sending-spinner">⏳</span>
                      ) : (
                        <svg
                          fill="none"
                          height="20"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                          width="20"
                        >
                          <line x1="22" x2="11" y1="2" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                      )}
                    </button>

                    <button
                      aria-label={t("voiceMessage", "Голосовое сообщение")}
                      className={`thread-composer-action-btn thread-mic-btn ${!draft.trim() && !pendingAttachment ? "is-visible" : ""
                        }`}
                      type="button"
                    >
                      <svg
                        fill="none"
                        height="20"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        width="20"
                      >
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="23" />
                        <line x1="8" x2="16" y1="23" y2="23" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {selectionMode && (
                <div className="thread-composer-row justify-between">
                  <div className="flex items-center gap-x-2">
                    <button
                      type="button"
                      onClick={() => runMessageAction(handleForward)}
                      className="flex items-center gap-x-1 w-auto action-btn px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl"
                    >
                      <Icon name="forward" />
                      {!isMobile && <span>{t("forward", "Переслать")}</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => runMessageAction(handleCopyMessage)}
                      className="flex items-center gap-x-1 w-auto action-btn px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl"
                    >
                      <Icon name="copy" />
                      {!isMobile && <span>{t("copy", "Скопировать")}</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => runMessageAction(handleDelete)}
                      className="flex items-center gap-x-1 w-auto action-btn px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl"
                    >
                      <Icon name="trash" />
                      {!isMobile && <span>{t("delete", "Удалить")}</span>}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelSelection}
                    className="w-auto action-btn px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl"
                  >
                    <span>{t("cancel", "Отмена")}</span>
                  </button>
                </div>
              )}
            </div>
          </form>

          {chat?.type === "group" && (
            <GroupInfoModal
              chatId={chatId}
              isOpen={isGroupInfoOpen}
              onClose={() => setIsGroupInfoOpen(false)}
            />
          )}

          {profileMode === "modal" && (
            <UserProfileModal
              onClose={() =>
                setProfileModal({
                  isOpen: false,
                  isLoading: false,
                  error: "",
                  user: null,
                })
              }
              profileModal={profileModal}
            />
          )}

          {photoEditorFile && (
            <PhotoEditorModal
              file={photoEditorFile}
              onCancel={closePhotoEditor}
              onSave={handlePhotoEditorSave}
            />
          )}
        </main>
      )}
    </>
  );
}
