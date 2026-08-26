import { CHAT_ROLES, CHAT_TYPES } from '@/consts';
import { useToasts } from './useToasts';
import { chatQuery } from '@/queries/chat/threadQueries';
import { dropThreadMessage, patchThreadMessage } from '@/queries/chat/threadCacheActions';
import { services } from '@/services/serviceContainer';
import { translateText } from '@/services/translatorApi';
import { useChatUiStore, useProfileStore } from '@/store';
import type { IMessageDto } from '@/types';
import { sortMessagesChronologically } from '@/utils/sortMessagesChronologically';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  const { data: chat } = useQuery(chatQuery(chatId));
  const chatType = chat?.type;
  const chatRole = chat?.role;
  const setError = useChatUiStore((state) => state.setError);
  const editingMessage = useChatUiStore((state) => state.editingMessage);
  const setEditingMessage = useChatUiStore((state) => state.setEditingMessage);
  const setDraft = useChatUiStore((state) => state.setDraft);
  const replyToMessage = useChatUiStore((state) => state.replyToMessage);
  const setReplyToMessage = useChatUiStore((state) => state.setReplyToMessage);
  const selectedMessages = useChatUiStore((state) => state.selectedMessages);
  const setSelectedMessages = useChatUiStore((state) => state.setSelectedMessages);
  const selectionMode = useChatUiStore((state) => state.selectionMode);
  const setSelectionMode = useChatUiStore((state) => state.setSelectionMode);
  const translations = useChatUiStore((state) => state.translations);
  const setTranslations = useChatUiStore((state) => state.setTranslations);
  const setActionMenu = useChatUiStore((state) => state.setActionMenu);

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
        // Удалять можно только свои сообщения — чужие отсеиваются заранее,
        // иначе в набор попадали undefined вместо идентификаторов.
        const own = selectedMessages.filter((item) => item.senderId === currentUser?.id);

        // Именно возврат промиса делает ожидание настоящим: без него
        // Promise.all завершался мгновенно, а отказы становились
        // необработанными и не доходили до catch.
        await Promise.all(own.map((item) => services.messageService.deleteMessage(item.id)));

        own.forEach((item) => dropThreadMessage(queryClient, chatId, item.id));
        handleCancelSelection();
      }

      if (!selectionMode) {
        if (message.senderId !== currentUser?.id) return;
        await services.messageService.deleteMessage(message.id);
        dropThreadMessage(queryClient, chatId, message.id);
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
      patchThreadMessage(queryClient, chatId, message.id, { reactions: result.reactions || [] });
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
        chatRole !== CHAT_ROLES.ADMIN &&
        chatRole !== CHAT_ROLES.OWNER
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
        chatRole !== CHAT_ROLES.ADMIN &&
        chatRole !== CHAT_ROLES.OWNER
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
      const sortedMessages = sortMessagesChronologically<IMessageDto>(selectedMessages);

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
