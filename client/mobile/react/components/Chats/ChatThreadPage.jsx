import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { services } from '../../../application/services/serviceContainer.js';
import Message from '../../../domain/entities/Message.js';
import { formatSize } from '../../../utils/formatSize.js';
import { sortMessagesChronologically } from '../../../utils/sortMessagesChronologically.js';
import { useRealtimeSocket } from '../../hooks/useRealtimeSocket.js';
import { useToasts } from '../../hooks/useToasts.js';
import { translateText } from '../../services/translatorApi.js';
import { useCall } from '../Calls/CallProvider.jsx';
import { Identicon } from '../common/Identicon.jsx';
import { MessageCheckbox } from '../common/MessageCheckbox.jsx';
import { PinnedMessages } from '../common/PinnedMessages.jsx';
import { ForwardChatMessagesModal } from './ForwardChatMessagesModal.jsx';
import { GroupInfoModal } from './GroupInfoModal.jsx';
import '../../styles/ChatThreadPage.css';

export function ChatThreadPage({
  chatId,
  onProfileStateChange,
  profileCloseToken = 0,
  profileMode = 'modal',
  t = fallbackTranslate,
}) {
  const [chat, setChat] = useState(null);
  const [draft, setDraft] = useState("");
  const [editingMessage, setEditingMessage] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [openedImage, setOpenedImage] = useState(null);
  const [typingUserId, setTypingUserId] = useState(null);
  const [actionMenu, setActionMenu] = useState(null);
  const [profileModal, setProfileModal] = useState({
    isOpen: false,
    isLoading: false,
    error: "",
    user: null,
  });
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [translations, setTranslations] = useState({});
  const [translatingIds, setTranslatingIds] = useState(new Set());
  const currentUser = useMemo(() => getCurrentUser(), []);
  const bottomRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const lastTypingSentAtRef = useRef(0);
  const typingTimeoutRef = useRef(null);
  const draftRef = useRef(null);
  const { eventBus, socket } = useRealtimeSocket(Boolean(chatId));
  const { initiateCall } = useCall();
  const { showToast } = useToasts();

  const [showCallMenu, setShowCallMenu] = useState(false);
  const timerRef = useRef(null);
  const isLongPress = useRef(false);

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
    initiateCall(chatId, chat?.type, title, 'audio');
  };
  
  useEffect(() => {
    if (profileMode !== "panel" || typeof onProfileStateChange !== "function")
      return undefined;
    onProfileStateChange({ ...profileModal, chat, messages });
    return undefined;
  }, [chat, messages, onProfileStateChange, profileMode, profileModal]);

  useEffect(() => {
    setProfileModal({ isOpen: false, isLoading: false, error: "", user: null });
  }, [chatId]);

  useEffect(() => {
    if (profileCloseToken === 0) return;
    setProfileModal({ isOpen: false, isLoading: false, error: "", user: null });
  }, [profileCloseToken]);

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
    let isMounted = true;

    Promise.all([
      services.chatService.getChat(chatId),
      services.messageService.getMessages(chatId),
      services.messageService.listPins(chatId),
    ])
      .then(([nextChat, nextMessages, nextPinnedMessages]) => {
        if (!isMounted) return;
        setChat(nextChat);
        setMessages(nextMessages);
        markMessagesAsRead(chatId, nextMessages);
        setPinnedMessages(nextPinnedMessages);
        setError("");
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || t("chatLoadError", "Не удалось загрузить чат"));
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [chatId, t]);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ block: "end" });
    }
  }, [messages.length]);

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
      const pins = await services.messageService.listPins(chatId);
      setPinnedMessages(pins);
    });
    const unsubscribeUnpinned = eventBus.on("message_unpinned", (event) => {
      if (event.chatId && event.chatId !== chatId) return;
      setPinnedMessages((items) =>
        items.filter((item) => item.messageId !== event.messageId),
      );
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
    setPendingAttachment({ file, type: getMediaMessageType(file.type) });
    setEditingMessage(null);
    setError("");
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

  async function handleDelete(message) {
    try {
      if (selectionMode) {
        await Promise.all(
          selectedMessages.map((selectedMessage) => {
            if (selectedMessage.senderId !== currentUser?.id) return;

            handleUnpinMessage(selectedMessage);
            services.messageService.deleteMessage(selectedMessage.id);
          }),
        );

        const selectedIds = new Set(
          selectedMessages.map((message) => {
            if (message.senderId !== currentUser?.id) return;
            return message.id;
          }),
        );

        setMessages((messages) =>
          messages.filter((message) => !selectedIds.has(message.id)),
        );
        setSelectedMessages([]);
        setSelectionMode(false);
      }

      if (!selectionMode) {
        if (message.senderId !== currentUser?.id) return;
        await handleUnpinMessage(message);
        await services.messageService.deleteMessage(message.id);
        setMessages((items) => items.filter((item) => item.id !== message.id));
        if (editingMessage?.id === message.id) {
          setEditingMessage(null);
          setDraft("");
        }
        if (replyToMessage?.id === message.id) {
          setReplyToMessage(null);
        }
      }
      setError("");
    } catch (err) {
      setError(
        err.message ||
          t("messageDeleteError", "Не удалось удалить сообщение(я)"),
      );
    }
  }

  async function handleReact(message, emoji) {
    try {
      const result = await services.messageService.reactToMessage(
        message.id,
        emoji,
      );
      setMessages((items) =>
        updateMessage(items, message.id, { reactions: result.reactions || [] }),
      );
      setError("");
    } catch (err) {
      setError(
        err.message || t("reactionError", "Не удалось обновить реакцию"),
      );
    }
  }

  function openMessageActions(message, rect, clientX, clientY) {
    const menuWidth = 232;
    const menuHeight = 350;
    const gap = 12;
    const padding = 8;

    const viewportWidth = window.innerWidth || menuWidth;
    const viewportHeight = window.innerHeight || menuHeight;

    const x = Math.min(
      Math.max(clientX + gap, padding),
      viewportWidth - menuWidth - padding,
    );

    const y = Math.min(
      Math.max(clientY + gap, padding),
      viewportHeight - menuHeight - padding,
    );
    setActionMenu({ messageId: message.id, x, y });
  }

  function closeMessageActions() {
    setActionMenu(null);
  }

  function runMessageAction(action) {
    action();
    closeMessageActions();
  }

  function startEdit(message) {
    setEditingMessage(message);
    setReplyToMessage(null);
    setDraft(message.content || "");
    draftRef.current.focus();
  }

  function startReply(message) {
    setReplyToMessage(message);
    setEditingMessage(null);
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

  function handleCopyMessage(message) {
    if (selectionMode) {
      const sortedMessages = sortMessagesChronologically(selectedMessages);

      const allContent = sortedMessages
        .map((message) => message.content)
        .join("\n");
      navigator.clipboard.writeText(allContent);
      return;
    }

    navigator.clipboard.writeText(message.content);
  }

  async function handlePinMessage(message) {
    try {
      await services.messageService.pinMessage(chatId, message.id);
      setPinnedMessages((prev) => {
        const alreadyPinned = prev.some(
          (pinnedMessage) => pinnedMessage.messageId === message.id,
        );

        if (alreadyPinned) {
          showToast(
            "error",
            t("messageAlreadyPinned", "Это сообщение уже закреплено"),
            "❌",
          );
          return prev;
        }

        return [...prev, { message, messageId: message.id }];
      });
    } catch (err) {
      setError(
        err.message || t("messagePinError", "Не удалось закрепить сообщение"),
      );
    }
  }

  async function handleUnpinMessage(message) {
    try {
      await services.messageService.unpinMessage(chatId, message.id);
      setPinnedMessages((messages) => {
        const pinnedMessage = messages.find(
          (pinned) => pinned.messageId === message.id,
        );
        if (!pinnedMessage) {
          showToast(
            "error",
            t("messageAlreadyUnpinned", "Это сообщение уже откреплено"),
            "❌",
          );
        }

        return messages.filter((pinned) => pinned.messageId !== message.id);
      });
    } catch (err) {
      setError(
        err.message || t("messagePinError", "Не удалось открепить сообщение"),
      );
    }
  }

  function startSelection(message) {
    setSelectionMode(true);
    setSelectedMessages([message]);
    setActionMenu(null);
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

  function handleForward(message) {
    if (selectionMode) {
      setIsForwardModalOpen(true);
      return;
    }

    setSelectedMessages([message]);
    setIsForwardModalOpen(true);
  }

  const handleCloseForwardModal = () => {
    if (selectionMode) {
      setIsForwardModalOpen(false);
      return;
    }

    setSelectedMessages([]);
    setIsForwardModalOpen(false);
  };

  async function handleTranslateMessage(message) {
    if (translations[message.id]) {
      setTranslations((prev) => {
        const next = { ...prev };
        delete next[message.id];
        return next;
      });
      return;
    }

    setTranslatingIds((prev) => new Set(prev).add(message.id));
    try {
      const { translatedText, targetLanguage, detectedSourceLang } =
        await translateText(message.content);

      if (detectedSourceLang && detectedSourceLang === targetLanguage) {
        showToast(
          "success",
          t("alreadySameLanguage", "Сообщение уже на вашем языке"),
          "ℹ️",
        );
        return;
      }

      setTranslations((prev) => ({ ...prev, [message.id]: translatedText }));
    } catch (err) {
      showToast(
        "error",
        t("translateError", "Не удалось перевести сообщение"),
        "❌",
      );
    } finally {
      setTranslatingIds((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  }

  const title = chat?.name || chat?.title || t("chat", "Чат");
  const subtitle = getChatSubtitle(chat, typingUserId, t);
  const isPeerOnline = Boolean(chat?.type === "private" && chat?.peerIsOnline);
  const peerAvatarUrl = chat?.avatarUrl || "";
  const selectedActionMessage = actionMenu
    ? messages.find((message) => message.id === actionMenu.messageId)
    : null;

  return (
    <main className="thread-page">
      {isForwardModalOpen && (
        <ForwardChatMessagesModal
          messages={selectedMessages}
          onClose={handleCloseForwardModal}
          setSelectedMessages={setSelectedMessages}
          setSelectionMode={setSelectionMode}
          t={t}
        />
      )}
      <header className="thread-header">
{/* Левый блок: аватар и информация о чате */}
<Link
  aria-label={t('back', 'Назад')}
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
      chat?.type === 'group' || chat?.type === 'private'
        ? 'pointer'
        : 'default',
  }}
>
  <button
    aria-label={title}
    className={`thread-avatar ${isPeerOnline ? 'is-online' : ''}`}
    tabIndex={-1}
    type="button"
  >
    {peerAvatarUrl ? (
      <img alt="" src={peerAvatarUrl} />
    ) : chat?.type === 'private' && chat?.peerId ? (
      <Identicon size={44} userId={chat.peerId} />
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
          'audio',
          chat?.peerId,
        )
      }
      title={t('audioCall', 'Аудиозвонок')}
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
          'video',
          chat?.peerId,
        )
      }
      title={t('videoCall', 'Видео')}
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
              'audio',
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
          {t('audioCall', 'Аудио')}
        </button>

        <button
          onClick={() => {
            setShowCallMenu(false);
            initiateCall(
              chatId,
              chat?.type,
              title,
              'video',
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
          {t('videoCall', 'Видео')}
        </button>
      </div>
    ) : null}
  </div>
</div>
      </header>

      <PinnedMessages messages={pinnedMessages} t={t} />

      <section className="thread-messages" aria-busy={isLoading}>
        {isLoading ? <ThreadSkeleton /> : null}
        {!isLoading && error && messages.length === 0 ? (
          <ThreadState
            message={error}
            title={t("loadingError", "Ошибка загрузки")}
          />
        ) : null}
        {!isLoading && !error && messages.length === 0 ? (
          <ThreadState
            message={t(
              "emptyThreadDescription",
              "Напишите первое сообщение в этом чате.",
            )}
            title={t("emptyThread", "Сообщений пока нет")}
          />
        ) : null}
        {messages.map((message) => (
          <MessageBubble
            currentUserId={currentUser?.id}
            isActionTarget={actionMenu?.messageId === message.id}
            selectionMode={selectionMode}
            key={message.id}
            message={message}
            messages={messages}
            selectedMessages={selectedMessages}
            translations={translations}
            onOpenActions={openMessageActions}
            onOpenImage={(url) => setOpenedImage(url)}
            onSelection={toggleMessageSelection}
            t={t}
          />
        ))}
        <div ref={bottomRef} />
      </section>

      {actionMenu && selectedActionMessage && (
        <>
          <div aria-hidden="true" className="message-actions-backdrop" />
          <MessageActionsPopover
            actionMenu={actionMenu}
            currentUserId={currentUser?.id}
            message={selectedActionMessage}
            pinnedMessages={pinnedMessages}
            selectionMode={selectionMode}
            selectedMessages={selectedMessages}
            onDelete={handleDelete}
            onEdit={startEdit}
            onReact={handleReact}
            onReply={startReply}
            runAction={runMessageAction}
            onCopy={handleCopyMessage}
            onPin={handlePinMessage}
            onUnpin={handleUnpinMessage}
            onStartSelection={startSelection}
            onSelection={toggleMessageSelection}
            onForward={handleForward}
            onTranslate={handleTranslateMessage}
            t={t}
          />
        </>
      )}

      {error && messages.length > 0 ? (
        <div className="thread-inline-error">{error}</div>
      ) : null}

      {openedImage ? (
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
      ) : null}

      <form className="thread-composer" onSubmit={handleSubmit}>
<div className="thread-composer-card">
  {editingMessage || replyToMessage ? (
    <div className="thread-composer-context">
      <span>
        {editingMessage
          ? t('editingMessage', 'Редактирование')
          : `${t('replyTo', 'Ответ')}: ${getMessagePreview(replyToMessage)}`}
      </span>

      <button
        aria-label={t('cancel', 'Отменить')}
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

  {pendingAttachment ? (
    <div className="thread-attachment-preview">
      <span aria-hidden="true">
        {getAttachmentIcon(pendingAttachment.type)}
      </span>

      <span title={pendingAttachment.file.name}>
        {pendingAttachment.file.name}
      </span>

      <small>{formatFileSize(pendingAttachment.file.size)}</small>

      <button
        aria-label={t('removeAttachment', 'Убрать вложение')}
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
  ) : null}

  <div className="thread-composer-row">
    <input
      accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
      aria-label={t('attachFile', 'Прикрепить файл')}
      className="thread-file-input"
      onChange={handleAttachmentChange}
      ref={attachmentInputRef}
      type="file"
    />

    <button
      aria-label={t('attachFile', 'Прикрепить файл')}
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
      aria-label={t('message', 'Сообщение')}
      className="thread-composer-input"
      onChange={handleDraftChange}
      onKeyDown={handleComposerKeyDown}
      placeholder={t('messagePlaceholder', 'Сообщение...')}
      value={draft}
    />

    <button
      aria-label={t('emoji', 'Смайлики')}
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
        className={`thread-composer-action-btn thread-send-btn ${
          draft.trim() || pendingAttachment ? 'is-visible' : ''
        }`}
        disabled={(!draft.trim() && !pendingAttachment) || isSending}
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
        aria-label={t('voiceMessage', 'Голосовое сообщение')}
        className={`thread-composer-action-btn thread-mic-btn ${
          !draft.trim() && !pendingAttachment ? 'is-visible' : ''
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
</div>
</form>

      {chat?.type === "group" && (
        <GroupInfoModal
          chatId={chatId}
          isOpen={isGroupInfoOpen}
          onClose={() => setIsGroupInfoOpen(false)}
          t={t}
        />
      )}

      {profileMode === "modal" ? (
        <UserProfileModal
          chat={chat}
          error={profileModal.error}
          isLoading={profileModal.isLoading}
          isOpen={profileModal.isOpen}
          messages={messages}
          onClose={() =>
            setProfileModal({
              isOpen: false,
              isLoading: false,
              error: "",
              user: null,
            })
          }
          t={t}
          user={profileModal.user}
        />
      ) : null}
    </main>
  );
}

function getMediaMessageType(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function getAttachmentIcon(type) {
  return { image: "🖼️", video: "🎬", audio: "🎵", file: "📄" }[type] || "📎";
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function appendUniqueMessage(items, nextMessage) {
  if (items.some((message) => message.id === nextMessage.id)) return items;
  return [...items, nextMessage];
}

function updateMessage(items, messageId, patch) {
  return items.map((message) =>
    message.id === messageId ? { ...message, ...patch } : message,
  );
}
function updatePinnedMessage(items, messageId, patch) {
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

function renderMessageContent(content) {
  if (!content) return "";
  const parts = [];
  const regex = /(#[\wа-яА-ЯёЁ]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore) {
      parts.push(textBefore);
    }
    const hashtag = match[0];
    parts.push(
      <span
        key={match.index}
        className="hashtag-link"
        style={{
          color: "var(--rd-accent, #ff2d8b)",
          cursor: "pointer",
          fontWeight: "bold",
        }}
        onClick={() => {
          if (typeof window.handleUnifiedSearch === "function") {
            window.handleUnifiedSearch(hashtag);
          } else {
            alert(`Поиск по хэштегу: ${hashtag}`);
          }
        }}
      >
        {hashtag}
      </span>,
    );
    lastIndex = regex.lastIndex;
  }

  const textAfter = content.substring(lastIndex);
  if (textAfter) {
    parts.push(textAfter);
  }

  return parts.length > 0 ? parts : content;
}

function parseCallContent(content) {
  if (!content || typeof content !== "string") return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function formatCallDuration(seconds) {
  const total = Number(seconds) || 0;
  if (total <= 0) return "";
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest} сек`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function CallMessageContent({ message, t }) {
  const call = parseCallContent(message.content);
  const duration = formatCallDuration(call.duration);

  return (
    <div className="message-call-content">
      <div className="message-call-icon" aria-hidden="true">
        <PhoneIcon />
      </div>
      <div className="message-call-copy">
        <strong>{t("callEnded", "Звонок завершен")}</strong>
        {duration ? <span>{duration}</span> : null}
      </div>
    </div>
  );
}

function MessageBubble({
  currentUserId,
  isActionTarget,
  selectionMode,
  message,
  selectedMessages = [],
  messages,
  translations,
  onOpenActions,
  onOpenImage,
  onSelection,
  t,
}) {
  const mine = message.senderId === currentUserId;
  const longPressTimerRef = useRef(null);
  const longPressPointRef = useRef(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => () => window.clearTimeout(longPressTimerRef.current), []);

  function clearLongPress() {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function handleClickCapture(event) {
    if (selectionMode) {
      onSelection(message);
      return;
    }

    if (!suppressNextClickRef.current) return;
    suppressNextClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleContextMenu(event) {
    event.preventDefault();

    onOpenActions(
      message,
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
  }

  function handlePointerDown(event) {
    if (
      event.button !== 0 ||
      (event.pointerType !== "touch" && event.pointerType !== "pen")
    )
      return;
    const point = { x: event.clientX, y: event.clientY };
    const rect = event.currentTarget.getBoundingClientRect();
    longPressPointRef.current = point;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = true;
      onOpenActions(message, rect, point.x, point.y);
    }, 550);
  }

  function handlePointerMove(event) {
    if (!longPressTimerRef.current || !longPressPointRef.current) return;
    const deltaX = Math.abs(event.clientX - longPressPointRef.current.x);
    const deltaY = Math.abs(event.clientY - longPressPointRef.current.y);
    if (deltaX > 8 || deltaY > 8) clearLongPress();
  }

  const isSelected = selectedMessages.find(({ id }) => id === message.id);

  const repliedMessage = message.replyTo
    ? messages.find(({ id }) => id === message.replyTo)
    : null;

  const replyText =
    repliedMessage?.content?.trim() || message.replyToContent?.trim() || "";

  const replyImage =
    repliedMessage?.mediaUrl || message.replyToMediaUrl || null;

  return (
    <article
      id={message.id}
      onClickCapture={handleClickCapture}
      onContextMenu={handleContextMenu}
      onPointerCancel={clearLongPress}
      onPointerDown={handlePointerDown}
      onPointerLeave={clearLongPress}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPress}
      className={`flex justify-between gap-x-2 ${mine ? "justify-end" : ""}`}
    >
      <div
        className={`message-bubble ${mine ? "is-mine" : ""} ${hasMessageMedia(message) ? "has-media" : ""} ${isActionTarget ? "is-action-target" : ""} ${isSelected ? "is-selected bg-accent" : ""}`}
      >
        {!mine && (
          <div className="message-sender">
            {/* {message.senderFirstName || message.senderUsername || 'User'} */}
            {message.senderStatusEmoji && (
              <span className="sender-status-emoji" style={{ marginLeft: 6 }}>
                {message.senderStatusEmoji}
              </span>
            )}
          </div>
        )}
        {replyText && !replyImage && (
          <a
            href={`#${message.replyTo}`}
            className="message-reply-preview"
            aria-label={t("goToMessage", "Перейти к сообщению")}
          >
            {replyText}
          </a>
        )}
        {replyText && replyImage && (
          <a
            href={`#${message.replyTo}`}
            className="message-reply-preview"
            aria-label={t("goToMessage", "Перейти к сообщению")}
          >
            {replyText}
          </a>
        )}
        {!replyText && replyImage && (
          <div className="message-reply-preview">
            <a
              href={`#${message.replyTo}`}
              aria-label={t("goToMessage", "Перейти к сообщению")}
            >
              <img
                src={replyImage}
                alt=""
                className="message-reply-preview-image"
              />
            </a>
          </div>
        )}
        <MessageMedia message={message} onOpenImage={onOpenImage} t={t} />
        {message.type === "call" ? (
          <CallMessageContent message={message} t={t} />
        ) : (
          <div className="message-content">
            {renderMessageContent(translations[message.id] || message.content)}
          </div>
        )}
        {message.reactions?.length > 0 && (
          <div className="message-reactions">
            {message.reactions.map((reaction) => (
              <span
                className={reaction.myReaction ? "is-mine" : ""}
                key={reaction.emoji}
              >
                {reaction.emoji} {reaction.count}
              </span>
            ))}
          </div>
        )}
        <div className="message-meta">
          {message.isEdited ? <span>{t("edited", "изменено")}</span> : null}
          <time>
            {formatMessageTime(message.timestamp || message.createdAt)}
          </time>
        </div>
      </div>
      {selectionMode && (
        <MessageCheckbox
          isChecked={isSelected}
          t={t}
          className="grow-0 self-end"
        />
      )}
    </article>
  );
}

const PinIcon = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      stroke="currentColor"
      className={`opacity-90 fill-transparent ${className}`}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
};

const LanguageIcon = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      stroke="currentColor"
      className="opacity-90 fill-transparent"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
};

const CheckCircleIcon = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      stroke="currentColor"
      className="opacity-90 fill-transparent"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
};

const ForwardIcon = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 17 5-5-5-5" />
      <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </svg>
  );
};

function MessageActionsPopover({
  actionMenu,
  currentUserId,
  message,
  pinnedMessages,
  selectionMode,
  selectedMessages,
  onDelete,
  onEdit,
  onReact,
  onReply,
  runAction,
  onCopy,
  onPin,
  onUnpin,
  onStartSelection,
  onSelection,
  onForward,
  onTranslate,
  t,
}) {
  const mine = message.senderId === currentUserId;
  const reactions = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
  const isPinned = pinnedMessages.find(
    (pinned) => pinned.messageId === message.id,
  );
  const isSelected = selectedMessages.find(({ id }) => id === message.id);

  return (
    <div
      className="message-actions-popover"
      onClick={(event) => event.stopPropagation()}
      style={{ left: actionMenu.x, top: actionMenu.y }}
    >
      <div className="message-reaction-actions">
        {reactions.map((emoji) => (
          <button
            aria-label={emoji}
            key={emoji}
            onClick={() => runAction(() => onReact(message, emoji))}
            type="button"
            className="shrink-0"
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="message-text-actions">
        {!selectionMode && (
          <button
            onClick={() => runAction(() => onReply(message))}
            type="button"
          >
            <ReplyIcon />
            <span>{t("reply", "Ответить")}</span>
          </button>
        )}
        {(message.type === "text" || message.content) && (
          <button
            onClick={() => runAction(() => onCopy(message))}
            type="button"
          >
            <CopyIcon />
            <span>{t("copy", "Скопировать")}</span>
          </button>
        )}
        {!mine && !selectionMode && (
          <button
            type="button"
            onClick={() => runAction(() => onTranslate(message))}
          >
            <LanguageIcon />
            <span>{t("translate", "Перевести")}</span>
          </button>
        )}
        {mine && !selectionMode && (
          <button
            onClick={() => runAction(() => onEdit(message))}
            type="button"
          >
            <EditIcon />
            <span>{t("edit", "Изменить")}</span>
          </button>
        )}
        {!isPinned && !selectionMode && (
          <button onClick={() => runAction(() => onPin(message))} type="button">
            <PinIcon />
            <span>{t("pin", "Закрепить")}</span>
          </button>
        )}
        {isPinned && !selectionMode && (
          <button
            onClick={() => runAction(() => onUnpin(message))}
            type="button"
          >
            <PinIcon />
            <span>{t("unpin", "Открепить")}</span>
          </button>
        )}
        <button
          onClick={() => runAction(() => onForward(message))}
          type="button"
        >
          <ForwardIcon />
          <span>{t("forward", "Переслать")}</span>
        </button>
        {mine && (
          <button
            className="is-danger"
            onClick={() => runAction(() => onDelete(message))}
            type="button"
          >
            <TrashIcon />
            <span>{t("delete", "Удалить")}</span>
          </button>
        )}
        <button
          onClick={() => {
            if (selectionMode) {
              runAction(() => {
                onSelection(message);
              });

              return;
            }

            runAction(() => {
              onStartSelection(message);
            });
          }}
          type="button"
        >
          <CheckCircleIcon />
          <span>
            {isSelected
              ? t("uncheckMessage", "Снять выбор")
              : t("checkMessage", "Выбрать")}
          </span>
        </button>
      </div>
    </div>
  );
}

function ReplyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M10 8.5V4L3 10.5 10 17v-4.6h4.4c2.3 0 4.1 1.1 5.6 3.4-.4-4.6-2.9-7.3-7.5-7.3H10Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.5 16.9v2.6h2.6L17.8 8.8l-2.6-2.6L4.5 16.9Zm14.9-9.7a1.4 1.4 0 0 0 0-2l-.6-.6a1.4 1.4 0 0 0-2 0l-.7.7 2.6 2.6.7-.7Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8.5 4.5 9.4 3h5.2l.9 1.5H20v2H4v-2h4.5Zm-2.2 4h11.4l-.8 11A2.5 2.5 0 0 1 14.4 22H9.6a2.5 2.5 0 0 1-2.5-2.5l-.8-11Z" />
    </svg>
  );
}

function MessageMedia({ message, onOpenImage, t }) {
  if (message.mediaUnavailable) {
    return (
      <div className="message-media-unavailable">
        {message.mediaUnavailableReason ||
          t(
            "mediaUnavailableUnencrypted",
            "Медиа недоступно: файл не зашифрован",
          )}
      </div>
    );
  }

  if (!message.mediaUrl) return null;

  const type = message.mediaType || message.type;
  if (type === "image" || type === "gif" || type === "sticker") {
    return (
      <button
        aria-label={t("openImage", "Открыть изображение")}
        className="message-media-open"
        onClick={() => onOpenImage(message.mediaUrl)}
        type="button"
      >
        <img
          alt=""
          className={`message-media message-media-${type}`}
          src={message.mediaUrl}
        />
      </button>
    );
  }
  if (type === "video") {
    return <video className="message-media" controls src={message.mediaUrl} />;
  }
  if (type === "audio" || type === "voice") {
    return <audio className="message-media" controls src={message.mediaUrl} />;
  }
  if (type === "file") {
    return (
      <a className="message-media-file" download href={message.mediaUrl}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
          <path d="M14 2v5a1 1 0 0 0 1 1h5" />
        </svg>
        <div className="message-media-file__content">
          <span className="message-media-file__title">
            {message.mediaEncryption.fileName}
          </span>
          <span className="message-media-file__size">
            {formatSize(message.mediaEncryption.sizeBytes)}
          </span>
        </div>
      </a>
    );
  }

  return null;
}

function hasMessageMedia(message) {
  return Boolean(message.mediaUrl || message.mediaUnavailable);
}

function UserProfileModal({
  chat,
  error,
  isLoading,
  isOpen,
  messages,
  onClose,
  t,
  user,
}) {
  if (!isOpen) return null;

  return (
    <div className="user-profile-modal" onClick={onClose} role="presentation">
      <UserProfilePanel
        chat={chat}
        error={error}
        isLoading={isLoading}
        messages={messages}
        onClose={onClose}
        stopPropagation
        t={t}
        user={user}
      />
    </div>
  );
}

export function UserProfilePanel({
  chat,
  error,
  isLoading,
  messages = [],
  onClose,
  stopPropagation = false,
  t,
  user,
}) {
  const [editableUser, setEditableUser] = useState(user);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ firstName: "", bio: "" });
  const [editError, setEditError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { initiateCall } = useCall();
  const currentUser = getCurrentUser();
  const profileUser = editableUser || user;
  const isOwnProfile = Boolean(
    profileUser?.id && currentUser?.id && profileUser.id === currentUser.id,
  );
  const displayName =
    [profileUser?.firstName, profileUser?.lastName].filter(Boolean).join(" ") ||
    profileUser?.username ||
    chat?.name ||
    chat?.title ||
    t("user", "Пользователь");
  const username = profileUser?.username ? `@${profileUser.username}` : "";
  const status = profileUser?.isBot
    ? t("bot", "бот")
    : getChatSubtitle(chat, null, t);
  const avatarUrl = profileUser?.avatarUrl || chat?.avatarUrl || "";
  const canCall = Boolean(chat?.id);
  const sharedMedia = messages.filter(
    (message) =>
      message.mediaUrl &&
      ["image", "gif", "sticker", "video"].includes(
        message.mediaType || message.type,
      ),
  );

  useEffect(() => {
    setEditableUser(user);
    setIsEditing(false);
    setEditError("");
  }, [user]);

  function startAudioCall() {
    if (!canCall) return;
    initiateCall(chat.id, chat?.type, displayName, "audio", chat?.peerId);
  }

  function startVideoCall() {
    if (!canCall) return;
    initiateCall(chat.id, chat?.type, displayName, "video", chat?.peerId);
  }

  function copyText(value) {
    if (!value || !navigator?.clipboard) return;
    navigator.clipboard.writeText(value).catch(() => {});
  }

  function startEdit() {
    setEditDraft({
      firstName: profileUser?.firstName || displayName,
      bio: profileUser?.bio || "",
    });
    setEditError("");
    setIsEditing(true);
  }

  async function saveProfileEdit(event) {
    event.preventDefault();
    setIsSaving(true);
    setEditError("");
    try {
      const updated = await services.userService.updateMe({
        firstName: editDraft.firstName.trim(),
        bio: editDraft.bio,
      });
      setEditableUser(updated);
      setIsEditing(false);
    } catch (err) {
      setEditError(
        err.message || t("profileSaveError", "Не удалось сохранить профиль"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-label={t("profile", "Профиль")}
      className="user-profile-card"
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
    >
      <header className="user-profile-header">
        <button className="user-profile-back" onClick={onClose} type="button">
          <span aria-hidden="true">‹</span>
          {t("back", "Назад")}
        </button>
        <strong>{t("information", "Информация")}</strong>
        {isOwnProfile ? (
          <button
            className="user-profile-edit"
            onClick={isEditing ? () => setIsEditing(false) : startEdit}
            type="button"
          >
            {isEditing ? t("cancel", "Отмена") : t("editShort", "Изм.")}
          </button>
        ) : (
          <span />
        )}
      </header>

      {isLoading ? (
        <div className="user-profile-state">{t("loading", "Загрузка...")}</div>
      ) : error ? (
        <div className="user-profile-state is-error">{error}</div>
      ) : (
        <div className="user-profile-scroll">
          <div className="user-profile-hero">
            <div className="user-profile-avatar">
              {avatarUrl ? (
                <img alt="" src={avatarUrl} />
              ) : (
                <Identicon
                  userId={profileUser?.id || chat?.peerId || displayName}
                  size={112}
                />
              )}
            </div>
            <h2>{displayName}</h2>
            <p
              className={`user-profile-status ${chat?.peerIsOnline ? "is-online" : ""}`}
            >
              {status}
            </p>
          </div>

          <div className="user-profile-actions">
            <button onClick={onClose} type="button">
              <MessageCircleIcon />
              {t("chat", "Чат")}
            </button>
            <button disabled={!canCall} onClick={startAudioCall} type="button">
              <PhoneIcon />
              {t("call", "Звонок")}
            </button>
            <button
              disabled={!canCall}
              onClick={startVideoCall}
              title={t("videoCall", "Видеозвонок")}
              type="button"
            >
              <VideoIcon />
              {t("video", "Видео")}
            </button>
          </div>

          {isEditing ? (
            <form className="user-profile-edit-form" onSubmit={saveProfileEdit}>
              <label>
                <span>{t("name", "Имя")}</span>
                <input
                  onChange={(event) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      firstName: event.target.value,
                    }))
                  }
                  value={editDraft.firstName}
                />
              </label>
              <label>
                <span>{t("bio", "О себе")}</span>
                <textarea
                  onChange={(event) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      bio: event.target.value,
                    }))
                  }
                  rows={4}
                  value={editDraft.bio}
                />
              </label>
              {editError ? <p>{editError}</p> : null}
              <button
                disabled={isSaving || !editDraft.firstName.trim()}
                type="submit"
              >
                {isSaving
                  ? t("saving", "Сохранение...")
                  : t("save", "Сохранить")}
              </button>
            </form>
          ) : (
            <div className="user-profile-info-card">
              {username ? (
                <button
                  className="user-profile-copy-row"
                  onClick={() => copyText(username)}
                  type="button"
                >
                  <span>{t("username", "Имя пользователя")}</span>
                  <strong>{username}</strong>
                  <CopyIcon />
                </button>
              ) : null}
              <div className="user-profile-info-row">
                <span>{t("bio", "О себе")}</span>
                <strong>
                  {profileUser?.bio ||
                    t("profileBioEmpty", "Информация не указана")}
                </strong>
              </div>
            </div>
          )}

          <div className="user-profile-tabs">
            <button className="active" type="button">
              {t("media", "Медиа")}
            </button>
          </div>
          {sharedMedia.length ? (
            <div className="user-profile-media-grid">
              {sharedMedia.map((message) => {
                const type = message.mediaType || message.type;
                return (
                  <a
                    aria-label={t("openMedia", "Открыть медиа")}
                    href={message.mediaUrl}
                    key={message.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {type === "video" ? (
                      <video muted preload="metadata" src={message.mediaUrl} />
                    ) : (
                      <img alt="" loading="lazy" src={message.mediaUrl} />
                    )}
                    {type === "video" ? (
                      <span aria-hidden="true">▶</span>
                    ) : null}
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="user-profile-empty-media">
              {t("profileMediaEmpty", "Медиа пока не загружены")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MessageCircleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M20.5 11.8a8 8 0 0 1-8.3 7.7 8.6 8.6 0 0 1-3.3-.66L4.3 20l1.16-4A7.6 7.6 0 0 1 4.5 12 8 8 0 0 1 12.8 4.5a8 8 0 0 1 7.7 7.3Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <g fill="none">
        <path d="M0 0h24v24H0z" />
        <path
          fill="currentColor"
          d="M4.477 4.116c-2.924 3.217-1.362 8.196 2.932 12.51 4.204 4.222 9.407 5.8 12.486 2.936 1.685-1.567 1.436-4.343-.645-6.198l-.19-.161c-1.931-1.563-4.734-1.568-6.445-.027l-.088.082-.05-.042c-.187-.16-.43-.381-.724-.673l-.298-.303-.306-.326q-.138-.152-.246-.277l-.124-.147-.07.075c1.69-1.697 1.706-4.72.006-6.75-1.887-2.255-4.75-2.335-6.238-.699M9.335 5.97c1.18 1.41 1.049 3.371.099 4.325l-.148.14c-.63.567-1.246.901 1.032 3.218 2.458 2.499 2.765 1.622 3.405.952 1.006-1.01 2.975-1.104 4.329.103 1.497 1.334 1.335 2.868.617 3.536-2.222 2.067-6.476.636-9.984-2.888S3.621 7.734 5.81 5.326c.508-.558 2.101-1.057 3.526.644"
        />
      </g>
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <g fill="none">
        <path d="M0 0h24v24H0z" />
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M6.5 5.75A3.5 3.5 0 0 0 3 9.25v5.5a3.5 3.5 0 0 0 3.5 3.5h7a3.5 3.5 0 0 0 3.5-3.5v-.52l2.65 2.07A1.45 1.45 0 0 0 22 15.15v-6.3a1.45 1.45 0 0 0-2.35-1.15L17 9.77v-.52a3.5 3.5 0 0 0-3.5-3.5h-7Zm-1.7 3.5A1.7 1.7 0 0 1 6.5 7.55h7a1.7 1.7 0 0 1 1.7 1.7v5.5a1.7 1.7 0 0 1-1.7 1.7h-7a1.7 1.7 0 0 1-1.7-1.7v-5.5Zm12.2 2.8 3.2 2.5v-5.1L17 11.95v.1Z"
        />
      </g>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 7.5A2.5 2.5 0 0 1 10.5 5H18a2.5 2.5 0 0 1 2.5 2.5V15A2.5 2.5 0 0 1 18 17.5h-7.5A2.5 2.5 0 0 1 8 15V7.5Zm-4.5 2A2.5 2.5 0 0 1 6 7h.5v2H6a.5.5 0 0 0-.5.5V18a.5.5 0 0 0 .5.5h8.5a.5.5 0 0 0 .5-.5v-.5h2v.5a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V9.5Z" />
    </svg>
  );
}

function ThreadSkeleton() {
  return (
    <div className="thread-skeleton">
      <div className="message-bubble">
        <div className="skeleton-line skeleton-message" />
      </div>
      <div className="message-bubble is-mine">
        <div className="skeleton-line skeleton-message-short" />
      </div>
      <div className="message-bubble">
        <div className="skeleton-line skeleton-message" />
      </div>
    </div>
  );
}

function ThreadState({ message, title }) {
  return (
    <div className="thread-state">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("craneapp_user_data") || "null");
  } catch (_error) {
    return null;
  }
}

function formatMessageTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getMessagePreview(message) {
  if (!message) return "";
  return String(message.content || "").slice(0, 64);
}

function getChatSubtitle(chat, typingUserId, t) {
  if (typingUserId) return t("typing", "печатает...");
  if (chat?.type === "group") return t("groupChat", "Группа");
  if (chat?.peerIsOnline) return t("online", "онлайн");
  if (chat?.peerLastSeen) return formatLastSeen(chat.peerLastSeen, t);
  return t("lastSeenRecently", "был(а) недавно");
}

function formatLastSeen(value, t) {
  if (value === "recently") return t("lastSeenRecently", "был(а) недавно");
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return t("lastSeenRecently", "был(а) недавно");

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const formatted = new Intl.DateTimeFormat(
    undefined,
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        },
  ).format(date);

  return t("lastSeenAt", "был(а) {time}", { time: formatted }).replace(
    "{time}",
    formatted,
  );
}

function fallbackTranslate(_key, fallback) {
  return fallback;
}
