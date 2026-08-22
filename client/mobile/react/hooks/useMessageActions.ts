import { CHAT_ROLES, CHAT_TYPES } from '@/consts';
import { useToasts } from '@/hooks';
import { services, translateText } from '@/services';
import { useChatStore, useProfileStore } from '@/store';
import type { IMessageDto } from '@/types';
import { sortMessagesChronologically } from '@/utils';
import { useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

interface Props {
  setIsForwardModalOpen: Dispatch<SetStateAction<boolean>>;
  draftRef?: RefObject<HTMLInputElement | null>;
}

export const useMessageActions = ({ setIsForwardModalOpen, draftRef }: Props) => {
  const currentUser = useProfileStore((state) => state.user);
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { t } = useTranslation();
  const [translatingIds, setTranslatingIds] = useState(new Set());
  const chatType = useChatStore((state) => state.chat?.type);
  const chatRole = useChatStore((state) => state.chat?.role);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const setMessages = useChatStore((state) => state.setMessages);
  const setError = useChatStore((state) => state.setError);
  const editingMessage = useChatStore((state) => state.editingMessage);
  const setEditingMessage = useChatStore((state) => state.setEditingMessage);
  const setDraft = useChatStore((state) => state.setDraft);
  const replyToMessage = useChatStore((state) => state.replyToMessage);
  const setReplyToMessage = useChatStore((state) => state.setReplyToMessage);
  const selectedMessages = useChatStore((state) => state.selectedMessages);
  const setSelectedMessages = useChatStore((state) => state.setSelectedMessages);
  const selectionMode = useChatStore((state) => state.selectionMode);
  const setSelectionMode = useChatStore((state) => state.setSelectionMode);
  const translations = useChatStore((state) => state.translations);
  const setTranslations = useChatStore((state) => state.setTranslations);
  const setActionMenu = useChatStore((state) => state.setActionMenu);

  const { showToast } = useToasts();

  const handleTranslateMessage = async (message: IMessageDto) => {
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
      const { translatedText, targetLanguage, detectedSourceLang } = await translateText(
        message.content
      );

      if (detectedSourceLang && detectedSourceLang === targetLanguage) {
        showToast('success', t('alreadySameLanguage', 'Сообщение уже на вашем языке'), 'ℹ️');
        return;
      }

      setTranslations((prev) => ({ ...prev, [message.id]: translatedText }));
    } catch (err) {
      showToast('error', t('translateError', 'Не удалось перевести сообщение'), '❌');
    } finally {
      setTranslatingIds((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  };

  const handleDelete = async (message: IMessageDto) => {
    try {
      if (selectionMode) {
        // исравить тут, либо сортировка в хронологии, либо асинхронный цикл
        const sortedMessages = sortMessagesChronologically(selectedMessages)
        await Promise.all(
          sortedMessages.map((selectedMessage) => {
            if (selectedMessage.senderId !== currentUser?.id) return;

            services.messageService.deleteMessage(chatId, selectedMessage.id);
          })
        );

        const selectedIds = new Set(
          selectedMessages.map((message) => {
            if (message.senderId !== currentUser?.id) return;
            return message.id;
          })
        );

        setMessages((messages) => messages.filter((message) => !selectedIds.has(message.id)));
        handleCancelSelection();
      }

      if (!selectionMode) {
        if (message.senderId !== currentUser?.id) return;
        await services.messageService.deleteMessage(chatId, message.id);
        setMessages((items) => items.filter((item) => item.id !== message.id));
        if (editingMessage?.id === message.id) {
          setEditingMessage(null);
          setDraft('');
        }
        if (replyToMessage?.id === message.id) {
          setReplyToMessage(null);
        }
      }
      setError('');
    } catch (err: any) {
      setError(err.message || t('messageDeleteError', 'Не удалось удалить сообщение(я)'));
    }
  };

  const handleReact = async (message: IMessageDto, emoji: string) => {
    if (message.reactions.find((reaction) => reaction.myReaction) && !currentUser?.isPremium)
      return;

    try {
      const result = await services.messageService.reactToMessage(message.id, emoji);
      updateMessage(message.id, { reactions: result.reactions || [] });
      setError('');
    } catch (err: any) {
      setError(err.message || t('reactionError', 'Не удалось обновить реакцию'));
    }
  };

  const handleUnpinMessage = async (message: IMessageDto) => {
    try {
      if (selectionMode) {
        for (const message of selectedMessages) {
          await services.messageService.unpinMessage(chatId, message.id);
        }
        return;
      }

      await services.messageService.unpinMessage(chatId, message.id);
    } catch (err: any) {
      setError(err.message || t('messageUnpinError', 'Не удалось открепить сообщение'));
      if (
        chatType === CHAT_TYPES.GROUP &&
        (chatRole !== CHAT_ROLES.ADMIN || chatRole !== CHAT_ROLES.OWNER)
      ) {
        showToast(
          'error',
          t(
            'messageUnpinMemberError',
            'Не удалось открепить сообщение. У вас нет прав администратора.'
          ),
          '❌'
        );
        return;
      }

      showToast('error', t('messageUnpinError', 'Не удалось открепить сообщение'), '❌');
    }
  };

  const handlePinMessage = async (message: IMessageDto) => {
    try {
      if (selectionMode) {
        for (const message of selectedMessages) {
          await services.messageService.pinMessage(chatId, message.id);
        }
        return;
      }

      await services.messageService.pinMessage(chatId, message.id);
    } catch (err: any) {
      setError(err.message || t('messagePinError', 'Не удалось закрепить сообщение'));
      if (
        chatType === CHAT_TYPES.GROUP &&
        (chatRole !== CHAT_ROLES.ADMIN || chatRole !== CHAT_ROLES.OWNER)
      ) {
        showToast(
          'error',
          t(
            'messagePinMemberError',
            'Не удалось закрепить сообщение. У вас нет прав администратора.'
          ),
          '❌'
        );
        return;
      }

      showToast('error', t('messagePinError', 'Не удалось закрепить сообщение'), '❌');
    }
  };

  const startSelection = (message: IMessageDto) => {
    setSelectionMode(true);
    setSelectedMessages([message]);
    setActionMenu(null);
  };

  const handleForward = (message: IMessageDto) => {
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

  const startReply = (message: IMessageDto) => {
    setReplyToMessage(message);
    setEditingMessage(null);
    if (!draftRef || !draftRef.current) return;
    draftRef.current.focus();
  };

  const startEdit = (message: IMessageDto) => {
    setEditingMessage(message);
    setReplyToMessage(null);
    setDraft(message.content || '');
    if (!draftRef || !draftRef.current) return;
    draftRef.current.focus();
  };

  const closeMessageActions = () => {
    setActionMenu(null);
  };

  const runMessageAction = (action: any) => {
    action();
    closeMessageActions();
  };

  function handleCopyMessage(message: IMessageDto) {
    if (selectionMode) {
      const sortedMessages = sortMessagesChronologically(selectedMessages);

      const allContent = sortedMessages.map((message) => message.content).join('\n');
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
