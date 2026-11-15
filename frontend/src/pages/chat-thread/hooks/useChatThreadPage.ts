import type { IRichTextInputHandle } from '@/shared/ui';
import { describeApiError, useRealtimeSocket } from '@/shared/api';
import { useChatEncryption } from '@/features/chat-encryption';
import { usePhotoEditor } from './usePhotoEditor';
import { useChatModals } from '@/features/chat-actions';
import { useMessageActions, useMessageSelection } from '@/features/message-actions';
import { useProfilePanel } from '@/features/user-profile';
import { useEscapeKey } from '@/shared/lib';
import { chatQuery, useChatReadMark, useChatUiStore } from '@/entities/chat';
import {
  cancelOutboxMessage,
  pinsQuery,
  mergePins,
  retryMediaDownload,
  retryOutboxMessage,
} from '@/entities/message';
import { useProfileStore, type IProfileState } from '@/entities/user';
import type { IMessageDto } from '@/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useMarkAsRead } from './useMarkAsRead';
import {
  selectCurrentMatch,
  useMessageSearchEngine,
  useMessageSearchStore,
} from '@/features/message-search';
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
  const profileRequest = useChatUiStore((state) => state.profileRequest);
  const setProfileRequest = useChatUiStore((state) => state.setProfileRequest);

  const bottomRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<IRichTextInputHandle>(null);
  const messagesRef = useRef<HTMLElement>(null);
  const [threadElement, setThreadElement] = useState<HTMLElement | null>(null);

  const { socket } = useRealtimeSocket(Boolean(chatId));
  useChatEncryption(chatId);

  const { data: chat = null } = useQuery(chatQuery(chatId));
  // Отметка прочтения на момент открытия: по ней лента встаёт на новые (#839).
  const readMark = useChatReadMark(chat);
  const { t } = useTranslation();
  const sharedPins = useQuery(pinsQuery(chatId));
  const personalPins = useQuery(pinsQuery(chatId, 'personal'));
  const pinnedMessages = useMemo(
    () => mergePins(sharedPins.data ?? [], personalPins.data ?? []),
    [sharedPins.data, personalPins.data]
  );
  const pinsLoading = sharedPins.isPending || personalPins.isPending;
  const pinsError =
    sharedPins.isError || personalPins.isError
      ? t('pinDialog.loadError', 'Не удалось загрузить закрепления')
      : '';
  const {
    messages,
    isLoading,
    hasOlder,
    loadOlder,
    error: messagesError,
  } = useThreadMessages({ chatId, containerRef: messagesRef });

  const markMessagesAsRead = useMarkAsRead(chatId, currentUser?.id);

  useMessageSearchEngine({ chatId, loadedMessages: messages, hasOlder });
  const searchQuery = useMessageSearchStore((state) =>
    state.chatId === chatId ? state.query.trim() : ''
  );
  const searchCurrentId = useMessageSearchStore((state) =>
    state.chatId === chatId ? (selectCurrentMatch(state)?.id ?? null) : null
  );

  const modals = useChatModals();
  const { closePhotoEditor, savePhotoEditor } = usePhotoEditor({
    attachmentInputRef,
    photoEditorFile: modals.photoEditorFile,
    setPhotoEditorFile: modals.setPhotoEditorFile,
    setPendingAttachments: modals.setPendingAttachments,
  });
  const { profileModal, setProfileModal } = useProfilePanel({
    chat,
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
    confirmDelete,
    handleForward,
    handleCloseForwardModal,
    handleReact,
    handleTranslateMessage,
    confirmTranslate,
  } = useMessageActions({ draftRef, setIsForwardModalOpen: modals.setIsForwardModalOpen });

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

  // Стабильная ссылка: пузырь обёрнут в memo, новая функция на каждый
  // рендер перерисовывала бы всю ленту (#1062).
  const handleRetryMedia = useCallback(
    (message: IMessageDto) => retryMediaDownload(queryClient, message),
    [queryClient]
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
  // Переход к сообщению этого чата, поставленный до перехода в него, —
  // например, к оригиналу из «Избранного», — не сбрасывается (#1076).
  useEffect(() => {
    resetChatState(chatId);
    setProfileModal({ isOpen: false, userId: null });
  }, [chatId, resetChatState, setProfileModal]);

  // Профиль, который попросили открыть из истории звонков (#1074). Эффект
  // обязательно после сброса выше: эффекты выполняются в порядке
  // объявления. При переходе в чат сброс закроет профиль и снимет запрос,
  // а этот эффект откроет профиль по значению, взятому при отрисовке.
  // Объявленный раньше, он открыл бы профиль, а сброс тут же закрыл бы.
  useEffect(() => {
    if (!profileRequest || profileRequest.chatId !== chatId) return;
    setProfileRequest(null);
    setProfileModal({ isOpen: true, userId: profileRequest.userId });
  }, [chatId, profileRequest, setProfileModal, setProfileRequest]);

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
    pinsLoading,
    pinsError,
    messages,
    isLoading,
    hasOlder,
    loadOlder,
    readMark,
    markMessagesAsRead,
    searchQuery,
    searchCurrentId,
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
    threadElement,
    setThreadElement,
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
    confirmDelete,
    handleForward,
    handleTranslateMessage,
    confirmTranslate,
    handleCloseForwardModal,
    handleRetryMessage,
    handleRetryMedia,
    handleCancelMessage,
  };
}
