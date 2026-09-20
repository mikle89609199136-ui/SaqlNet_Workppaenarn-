import { describeApiError, useRealtimeSocket } from '@/shared/api';
import { useChatEncryption } from '@/features/chat-encryption';
import { usePhotoEditor } from '@/entities/media';
import { useChatModals } from '@/features/chat-actions';
import { useMessageActions, useMessageSelection } from '@/features/message-actions';
import { useProfilePanel } from '@/features/user-profile';
import { useAutoScrollToBottom, useEscapeKey } from '@/shared/lib';
import { chatQuery, useChatUiStore } from '@/entities/chat';
import { cancelOutboxMessage, pinsQuery, retryOutboxMessage } from '@/entities/message';
import { useProfileStore, type IProfileState } from '@/entities/user';
import type { IMessageDto } from '@/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useMarkAsRead } from './useMarkAsRead';
import { useThreadMessages } from './useThreadMessages';

interface Params {
  onProfileStateChange: Dispatch<SetStateAction<IProfileState>>;
  profileCloseToken: number;
  profileMode: 'modal' | 'panel';
}

/**
 * Собирает всю логику страницы треда чата в единый объект: данные чата и
 * сообщений, модалки, выделение, профиль, realtime-соединение и обработчики
 * действий над сообщениями. ChatThreadPage остаётся чистым слоем разметки.
 */
export function useChatThreadPage({
  onProfileStateChange,
  profileCloseToken,
  profileMode,
}: Params) {
  const { chatId = '' } = useParams<{ chatId: string }>();
  const currentUser = useProfileStore((state) => state.user);

  const error = useChatUiStore((state) => state.error);
  const setError = useChatUiStore((state) => state.setError);
  const setEditingMessage = useChatUiStore((state) => state.setEditingMessage);
  const selectedMessages = useChatUiStore((state) => state.selectedMessages);
  const setSelectedMessages = useChatUiStore((state) => state.setSelectedMessages);
  const selectionMode = useChatUiStore((state) => state.selectionMode);
  const setSelectionMode = useChatUiStore((state) => state.setSelectionMode);
  const actionMenu = useChatUiStore((state) => state.actionMenu);
  const setActionMenu = useChatUiStore((state) => state.setActionMenu);
  const resetChatState = useChatUiStore((state) => state.resetChatState);

  const bottomRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLElement>(null);

  const { socket } = useRealtimeSocket(Boolean(chatId));
  useChatEncryption(chatId);

  const { data: chat = null } = useQuery(chatQuery(chatId));
  const { data: pinnedMessages = [] } = useQuery(pinsQuery(chatId));
  const {
    messages,
    isLoading,
    hasOlder,
    loadOlder,
    error: messagesError,
  } = useThreadMessages({ chatId, containerRef: messagesRef });

  const markMessagesAsRead = useMarkAsRead(chatId, currentUser?.id);

  const modals = useChatModals();
  const { closePhotoEditor, savePhotoEditor } = usePhotoEditor({
    attachmentInputRef,
    setPhotoEditorFile: modals.setPhotoEditorFile,
    setPendingAttachment: modals.setPendingAttachment,
  });
  const { profileModal, setProfileModal } = useProfilePanel({
    chat,
    messages,
    chatId,
    profileMode,
    profileCloseToken,
    onProfileStateChange,
  });
  const { toggleMessageSelection, selectedActionMessage } = useMessageSelection(
    messages,
    actionMenu
  );

  const {
    handleCancelSelection,
    runMessageAction,
    handleCopyMessage,
    handleDelete,
    handleForward,
    handleCloseForwardModal,
    handleReact,
  } = useMessageActions({ draftRef, setIsForwardModalOpen: modals.setIsForwardModalOpen });

  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const handleRetryMessage = useCallback(
    (message: IMessageDto) => {
      setError('');
      void retryOutboxMessage(queryClient, message.tempId || message.id, {
        onError: (err) => {
          setError(
            describeApiError(
              err as { code?: string; message?: string },
              t,
              t('messageSendError', 'Не удалось отправить сообщение')
            )
          );
        },
        onSuccess: () => {
          setError('');
        },
      });
    },
    [queryClient, setError, t]
  );

  const handleCancelMessage = useCallback(
    (message: IMessageDto) => {
      const id = message.tempId || message.id;
      cancelOutboxMessage(queryClient, chatId, id);
    },
    [chatId, queryClient]
  );

  // Черновик, выделение и открытые меню принадлежат конкретному чату:
  // при переходе в соседний они не должны переезжать вместе с окном.
  useEffect(() => {
    resetChatState();
    setProfileModal({ isOpen: false, userId: null });
  }, [chatId, resetChatState, setProfileModal]);

  // Отмечаются только те, что ещё не отмечены: история меняется и от
  // собственных отправок, и от входящих, а лишний запрос здесь не нужен.
  useEffect(() => {
    if (isLoading) return;

    const unread = messages.filter((message) => !message.isRead);
    if (unread.length === 0) return;

    markMessagesAsRead(unread);
  }, [messages, isLoading, markMessagesAsRead]);

  useAutoScrollToBottom(bottomRef, chatId, isLoading);

  useEscapeKey({ active: selectionMode, onClose: handleCancelSelection });
  useEscapeKey({ active: Boolean(actionMenu), onClose: () => setActionMenu(null) });
  useEscapeKey({ active: Boolean(modals.openedImage), onClose: () => modals.setOpenedImage(null) });

  // actionMenu закрывается по клику в любом месте страницы: сам попап
  // останавливает всплытие внутри себя, чтобы клик по нему не гасил меню.
  useEffect(() => {
    if (!actionMenu) return undefined;

    const closeActionMenu = () => setActionMenu(null);
    window.addEventListener('click', closeActionMenu);
    return () => window.removeEventListener('click', closeActionMenu);
  }, [actionMenu, setActionMenu]);

  const threadError = error || messagesError;

  return {
    chatId,
    chat,
    pinnedMessages,
    messages,
    isLoading,
    hasOlder,
    loadOlder,
    threadError,
    setError,
    setEditingMessage,
    selectedMessages,
    setSelectedMessages,
    selectionMode,
    setSelectionMode,
    actionMenu,
    setActionMenu,

    bottomRef,
    attachmentInputRef,
    draftRef,
    messagesRef,
    socket,

    modals,
    closePhotoEditor,
    handlePhotoEditorSave: savePhotoEditor,

    profileModal,
    setProfileModal,

    toggleMessageSelection,
    handleReact,
    selectedActionMessage,

    handleCancelSelection,
    runMessageAction,
    handleCopyMessage,
    handleDelete,
    handleForward,
    handleCloseForwardModal,
    handleRetryMessage,
    handleCancelMessage,
  };
}
