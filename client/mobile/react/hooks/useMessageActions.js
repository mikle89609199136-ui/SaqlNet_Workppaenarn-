import { useState } from "react";
import { useToasts } from "../hooks/useToasts.js";
import services from "../services/serviceContainer.js";
import { translateText } from "../services/translatorApi";
import { useChatStore } from "../store/chat.js";
import { useTranslation } from "react-i18next";
import { sortMessagesChronologically } from "../../utils/sortMessagesChronologically.js";

export const useMessageActions = ({
  currentUser,
  chatId,
  chatType,
  chatRole,
  updateMessage,
  setIsForwardModalOpen,
  draftRef,
}) => {
  const { t } = useTranslation();
  const [translatingIds, setTranslatingIds] = useState(new Set());
  const {
    setMessages,
    setError,
    editingMessage,
    setEditingMessage,
    setDraft,
    replyToMessage,
    setReplyToMessage,
    selectedMessages,
    setSelectedMessages,
    setPinnedMessages,
    selectionMode,
    setSelectionMode,
    translations,
    setTranslations,
    setActionMenu,
  } = useChatStore();
  const { showToast } = useToasts();

  const handleTranslateMessage = async (message) => {
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
  };

  const handleDelete = async (message) => {
    try {
      if (selectionMode) {
        await Promise.all(
          selectedMessages.map((selectedMessage) => {
            if (selectedMessage.senderId !== currentUser?.id) return;

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
        handleCancelSelection();
      }

      if (!selectionMode) {
        if (message.senderId !== currentUser?.id) return;
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
  };

  const handleReact = async (message, emoji) => {
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
  };

  const handleUnpinMessage = async (message) => {
    try {
      if (selectionMode) {
        for (const message of selectedMessages) {
          await services.messageService.unpinMessage(chatId, message.id);
        }
        return;
      }

      await services.messageService.unpinMessage(chatId, message.id);
    } catch (err) {
      setError(
        err.message || t("messageUnpinError", "Не удалось открепить сообщение"),
      );
      if (
        chatType === "group" &&
        (chatRole !== "admin" || chatRole !== "owner")
      ) {
        showToast(
          "error",
          t(
            "messageUnpinMemberError",
            "Не удалось открепить сообщение. У вас нет прав администратора.",
          ),
          "❌",
        );
        return;
      }

      showToast(
        "error",
        t("messageUnpinError", "Не удалось открепить сообщение"),
        "❌",
      );
    }
  };

  const handlePinMessage = async (message) => {
    try {
      if (selectionMode) {
        for (const message of selectedMessages) {
          await services.messageService.pinMessage(chatId, message.id);
        }
        return;
      }

      await services.messageService.pinMessage(chatId, message.id);
    } catch (err) {
      setError(
        err.message || t("messagePinError", "Не удалось закрепить сообщение"),
      );
      if (
        chatType === "group" &&
        (chatRole !== "admin" || chatRole !== "owner")
      ) {
        showToast(
          "error",
          t(
            "messagePinMemberError",
            "Не удалось закрепить сообщение. У вас нет прав администратора.",
          ),
          "❌",
        );
        return;
      }

      showToast(
        "error",
        t("messagePinError", "Не удалось закрепить сообщение"),
        "❌",
      );
    }
  };

  const startSelection = (message) => {
    setSelectionMode(true);
    setSelectedMessages([message]);
    setActionMenu(null);
  };

  const handleForward = (message) => {
    if (selectionMode) {
      setIsForwardModalOpen(true);
      return;
    }

    setSelectedMessages([message]);
    setIsForwardModalOpen(true);
  };

  const handleCloseForwardModal = () => {
    if (selectionMode) {
      setIsForwardModalOpen(false);
      return;
    }

    setSelectedMessages([]);
    setIsForwardModalOpen(false);
  };

  const startReply = (message) => {
    setReplyToMessage(message);
    setEditingMessage(null);
    draftRef.current.focus();
  };

  const startEdit = (message) => {
    setEditingMessage(message);
    setReplyToMessage(null);
    setDraft(message.content || "");
    draftRef.current.focus();
  };

  const closeMessageActions = () => {
    setActionMenu(null);
  };

  const runMessageAction = (action) => {
    action();
    closeMessageActions();
  };

  function handleCopyMessage(message) {
    if (selectionMode) {
      const sortedMessages = sortMessagesChronologically(selectedMessages);

      const allContent = sortedMessages
        .map((message) => message.content)
        .join("\n");
      navigator.clipboard.writeText(allContent);
      handleCancelSelection();
      return;
    }

    navigator.clipboard.writeText(message.content);
  }

  function handleCancelSelection() {
    setSelectedMessages([]);
    setSelectionMode(false);
  }

  return {
    translatingIds,
    handleTranslateMessage,
    handleDelete,
    handleReact,
    handleUnpinMessage,
    handlePinMessage,
    startSelection,
    handleForward,
    handleCloseForwardModal,
    startReply,
    startEdit,
    closeMessageActions,
    runMessageAction,
    handleCopyMessage,
    handleCancelSelection,
  };
};
