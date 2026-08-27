import {
  ChatSelectedMessagesActions,
  ChatThreadComposer,
  ChatThreadHeader,
  ForwardChatMessagesModal,
  GroupInfoModal,
  MessageActionsPopover,
  PhotoEditorModal,
  PinnedMessagesNavigator,
  PinnedMessagesView,
  MessagesList,
  SafetyCodeNotice,
  UserProfileModal,
} from '@/components/features';

import { useChatEncryption, useMessageActions, useRealtimeSocket } from '@/hooks';
import { chatQuery, pinsQuery } from '@/queries/chat/threadQueries';
import { useChatUiStore, useProfileStore } from '@/store';
import '@/styles/ChatThreadPage.css';
import { useOutletContext, useParams } from 'react-router-dom';

import type { IChatDto, IMessageDto, IPendingAttachment, TMessagesList } from '@/types';
import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useTypingStore } from '@/store/typing';
import { useMarkAsRead } from './hooks/useMarkAsRead';
import { useThreadMessages } from './hooks/useThreadMessages';

export interface IProfileModal {
  isOpen: boolean;
  /** Чей профиль показывать. Сами данные читает панель — по этому идентификатору. */
  userId: string | null;
}

export interface IProfileState extends IProfileModal {
  chat: IChatDto | null;
  messages: TMessagesList;
}

interface IOutletContext {
  onProfileStateChange: Dispatch<SetStateAction<IProfileState>>;
  profileCloseToken: number;
  profileMode: 'modal' | 'panel';
}

const CLOSED_PROFILE: IProfileModal = { isOpen: false, userId: null };

export function ChatThreadPage() {
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { onProfileStateChange, profileCloseToken, profileMode } =
    useOutletContext<IOutletContext>();
  const { t } = useTranslation();

  const currentUser = useProfileStore((state) => state.user);

  // В сторе осталось только состояние интерфейса: данные чата живут в кеше запросов.
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

  const [pendingAttachment, setPendingAttachment] = useState<IPendingAttachment | null>(null);
  const [photoEditorFile, setPhotoEditorFile] = useState<File | null>(null);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [openedImage, setOpenedImage] = useState<string | null>(null);
  const [profileModal, setProfileModal] = useState<IProfileModal>(CLOSED_PROFILE);
  const [isPinnedMessagesOpen, setPinnedMessagesOpen] = useState(false);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLElement>(null);

  const { socket } = useRealtimeSocket(Boolean(chatId));

  // Ключ чата готовится до первой отправки, а не в момент нажатия
  // «отправить»: создание ключа и раздача его участникам — это несколько
  // запросов, и ждать их с уже набранным сообщением незачем.
  useChatEncryption(chatId);

  const { data: chat = null } = useQuery(chatQuery(chatId));
  const { data: pinnedMessages = [] } = useQuery(pinsQuery(chatId));
  const {
    messages,
    isLoading,
    error: messagesError,
  } = useThreadMessages({ chatId, containerRef: messagesRef });

  const markMessagesAsRead = useMarkAsRead(chatId, currentUser?.id);
  const typingUserId = useTypingStore((state) => state.typingByChat[chatId] ?? null);

  const {
    handleCancelSelection,
    runMessageAction,
    handleCopyMessage,
    handleDelete,
    handleForward,
    handleCloseForwardModal,
  } = useMessageActions({ draftRef, setIsForwardModalOpen });

  // Черновик, выделение и открытые меню принадлежат конкретному чату:
  // при переходе в соседний они не должны переезжать вместе с окном.
  useEffect(() => {
    resetChatState();
    setProfileModal(CLOSED_PROFILE);
  }, [chatId, resetChatState]);

  // Отмечаются только те, что ещё не отмечены: история меняется и от
  // собственных отправок, и от входящих, а лишний запрос здесь не нужен.
  useEffect(() => {
    if (isLoading) return;

    const unread = messages.filter((message) => !message.isRead);
    if (unread.length === 0) return;

    markMessagesAsRead(unread);
  }, [messages, isLoading, markMessagesAsRead]);

  useEffect(() => {
    if (profileMode !== 'panel' || typeof onProfileStateChange !== 'function') return;
    onProfileStateChange({ ...profileModal, chat, messages });
  }, [chat, messages, onProfileStateChange, profileMode, profileModal]);

  useEffect(() => {
    if (profileCloseToken === 0) return;
    setProfileModal(CLOSED_PROFILE);
  }, [profileCloseToken]);

  useEffect(() => {
    if (isLoading) return;

    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
    });
  }, [chatId, isLoading]);

  useEffect(() => {
    if (!selectionMode) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleCancelSelection();
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectionMode]);

  useEffect(() => {
    if (!actionMenu) return undefined;

    const closeActionMenu = () => setActionMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeActionMenu();
    };

    window.addEventListener('click', closeActionMenu);
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('click', closeActionMenu);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [actionMenu]);

  useEffect(() => {
    if (!openedImage) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenedImage(null);
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [openedImage]);

  function closePhotoEditor() {
    setPhotoEditorFile(null);

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }

  function handlePhotoEditorSave(file: File) {
    setPendingAttachment({ file, type: 'image' });
    setPhotoEditorFile(null);
    setEditingMessage(null);
    setError('');

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }

  const toggleMessageSelection = useCallback(
    (message: IMessageDto) => {
      setSelectedMessages((items) => {
        const isSelected = items.some(({ id }) => id === message.id);

        if (!isSelected) return [...items, message];

        const next = items.filter(({ id }) => id !== message.id);
        if (next.length === 0) setSelectionMode(false);

        return next;
      });
    },
    [setSelectedMessages, setSelectionMode]
  );

  const selectedActionMessage = actionMenu
    ? messages.find((message) => message.id === actionMenu.messageId)
    : null;

  const threadError = error || messagesError;

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
        <PinnedMessagesView
          pinnedMessages={pinnedMessages}
          onClose={() => setPinnedMessagesOpen(false)}
          isLoading={isLoading}
          error={threadError}
          openedImage={openedImage}
          setOpenedImage={setOpenedImage}
          onSelection={toggleMessageSelection}
          actionMenu={actionMenu}
          setIsForwardModalOpen={setIsForwardModalOpen}
          setPinnedMessagesOpen={setPinnedMessagesOpen}
        />
      )}
      {!isPinnedMessagesOpen && (
        <main className="thread-page">
          <ChatThreadHeader
            typingUserId={typingUserId}
            setIsGroupInfoOpen={setIsGroupInfoOpen}
            setProfileModal={setProfileModal}
            profileModal={profileModal}
          />

          <PinnedMessagesNavigator
            messages={pinnedMessages}
            setPinnedMessagesOpen={setPinnedMessagesOpen}
          />
          <MessagesList
            error={threadError}
            isLoading={isLoading}
            messages={messages}
            setOpenedImage={setOpenedImage}
            toggleMessageSelection={toggleMessageSelection}
            bottomRef={bottomRef}
            messagesRef={messagesRef}
          />

          {actionMenu && selectedActionMessage && (
            <>
              <div aria-hidden="true" className="message-actions-backdrop" />
              <MessageActionsPopover
                message={selectedActionMessage}
                onSelection={toggleMessageSelection}
                draftRef={draftRef}
                setIsForwardModalOpen={setIsForwardModalOpen}
              />
            </>
          )}

          {openedImage && (
            <div
              aria-label={t('imageViewer', 'Просмотр изображения')}
              aria-modal="true"
              className="image-viewer"
              onClick={() => setOpenedImage(null)}
              role="dialog"
            >
              <button
                aria-label={t('close', 'Закрыть')}
                className="image-viewer-close"
                onClick={() => setOpenedImage(null)}
                type="button"
              >
                ×
              </button>
              <img alt="" onClick={(event) => event.stopPropagation()} src={openedImage} />
            </div>
          )}

          <SafetyCodeNotice chatId={chatId} />

          {!selectionMode && (
            <ChatThreadComposer
              pendingAttachment={pendingAttachment}
              setPendingAttachment={setPendingAttachment}
              selectionMode={selectionMode}
              socket={socket}
              bottomRef={bottomRef}
              attachmentInputRef={attachmentInputRef}
              draftRef={draftRef}
              setPhotoEditorFile={setPhotoEditorFile}
            />
          )}
          {selectionMode && (
            <ChatSelectedMessagesActions
              handleCancelSelection={handleCancelSelection}
              onCopyMessage={() => runMessageAction(handleCopyMessage)}
              onDeleteMessage={() => runMessageAction(handleDelete)}
              onForwardMessage={() => runMessageAction(handleForward)}
            />
          )}

          {chat?.type === 'group' && (
            <GroupInfoModal isOpen={isGroupInfoOpen} onClose={() => setIsGroupInfoOpen(false)} />
          )}

          {profileMode === 'modal' && (
            <UserProfileModal
              onClose={() => setProfileModal(CLOSED_PROFILE)}
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
