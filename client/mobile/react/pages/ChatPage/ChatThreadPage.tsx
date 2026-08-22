import {
  ChatSelectedMessagesActions,
  ChatThreadComposer,
  ChatThreadHeader,
  ForwardChatMessagesModal,
  GroupInfoModal,
  MessageActionsPopover,
  PhotoEditorModal,
  PinnedMessages,
  UserProfileModal,
} from '@/components/components';
import { MessagesList } from '@/components/ui/';
import { useMessageActions, useRealtimeSocket } from '@/hooks';
import { getMessages, services } from '@/services';
import { useChatStore, useProfileStore } from '@/store';
import '@/styles/ChatThreadPage.css';
import { useLoaderData, useOutletContext, useParams } from 'react-router-dom';

import { WS_EVENTS } from '@/consts';
import { PinnedMessagesPage } from '@/pages';
import type {
  IChatDto,
  IMessageDto,
  IPendingAttachment,
  ITypingEvent,
  IUserDto,
  TMessagesList,
} from '@/types';
import { appendUniqueMessage } from '@/utils';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';

export interface IProfileModal {
  isOpen: boolean;
  isLoading: boolean;
  user: IUserDto | null;
  error: string;
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

export function ChatThreadPage() {
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { onProfileStateChange, profileCloseToken, profileMode } =
    useOutletContext<IOutletContext>();
  const { t } = useTranslation();
  const chat = useChatStore((state) => state.chat);
  const setChat = useChatStore((state) => state.setChat);
  const messages = useChatStore((state) => state.messages);
  const setMessages = useChatStore((state) => state.setMessages);
  const error = useChatStore((state) => state.error);
  const setError = useChatStore((state) => state.setError);
  const setEditingMessage = useChatStore((state) => state.setEditingMessage);
  const selectedMessages = useChatStore((state) => state.selectedMessages);
  const setSelectedMessages = useChatStore((state) => state.setSelectedMessages);
  const pinnedMessages = useChatStore((state) => state.pinnedMessages);
  const setPinnedMessages = useChatStore((state) => state.setPinnedMessages);
  const selectionMode = useChatStore((state) => state.selectionMode);
  const setSelectionMode = useChatStore((state) => state.setSelectionMode);
  const actionMenu = useChatStore((state) => state.actionMenu);
  const setActionMenu = useChatStore((state) => state.setActionMenu);
  const resetChatState = useChatStore((state) => state.resetChatState);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const updatePinnedMessage = useChatStore((state) => state.updatePinnedMessage);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAttachment, setPendingAttachment] = useState<IPendingAttachment | null>(null);
  const [photoEditorFile, setPhotoEditorFile] = useState<File | null>(null);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [openedImage, setOpenedImage] = useState<string | null>(null);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [profileModal, setProfileModal] = useState<IProfileModal>({
    isOpen: false,
    isLoading: false,
    error: '',
    user: null,
  });
  const [isPinnedMessagesOpen, setPinnedMessagesOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const currentUser = useProfileStore((state) => state.user);
  const bottomRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);

  const messagesRef = useRef<HTMLElement>(null);
  const chatIdRef = useRef(chatId);

  const { eventBus, socket } = useRealtimeSocket(Boolean(chatId));
  const { loadedChat, loadedMessages, loadedPinnedMessages } = useLoaderData();

  const {
    handleCancelSelection,
    runMessageAction,
    handleCopyMessage,
    handleDelete,
    handleForward,
    handleCloseForwardModal,
  } = useMessageActions({
    draftRef,
    setIsForwardModalOpen,
  });

  const loadMoreMessages = useCallback(async () => {
    const requestChatId = chatId;
    if (isLoadingMore || !hasMore) return;

    const container = messagesRef.current;
    if (!container) return;

    setIsLoadingMore(true);

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

    container.addEventListener('scroll', onScroll);

    return () => container.removeEventListener('scroll', onScroll);
  }, [loadMoreMessages]);

  useEffect(() => {
    if (profileMode !== 'panel' || typeof onProfileStateChange !== 'function') return;
    onProfileStateChange({ ...profileModal, chat, messages });
  }, [chat, messages, onProfileStateChange, profileMode, profileModal]);

  useEffect(() => {
    setProfileModal({ isOpen: false, isLoading: false, error: '', user: null });
  }, [chatId]);

  useEffect(() => {
    if (profileCloseToken === 0) return;
    setProfileModal({ isOpen: false, isLoading: false, error: '', user: null });
  }, [profileCloseToken]);

  useEffect(() => {
    if (!selectionMode) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleCancelSelection();
    };

    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('keydown', closeOnEscape);
    };
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
    eventBus.emit(WS_EVENTS.MESSAGE.LOCAL.READ, {chatId})
    setIsLoading(false);
  }, [loadedChat, loadedMessages, loadedPinnedMessages, chatId]);

  useEffect(() => {
    if (isLoading) return;

    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({
        block: 'end',
        behavior: 'auto',
      });
    });
  }, [chatId, isLoading]);

  useEffect(() => {
    const unsubscribeNew = eventBus.on(WS_EVENTS.MESSAGE.NEW, async (event) => {
      if (event.chatId !== chatId || !event.message) return;
      const nextMessage = await services.messageService.processMessageForDisplay(
        chatId,
        event.message
      );

      if (chatIdRef.current !== chatId) return;
      services.messageService.addMessageToCache(chatId, nextMessage);
      setMessages((items) => appendUniqueMessage(items, nextMessage));
      markMessagesAsRead(chatId, [nextMessage]);
    });

    const unsubscribeEdited = eventBus.on(WS_EVENTS.MESSAGE.EDITED, (event) => {
      updateMessage(event.messageId, {
        content: event.content,
        isEdited: true,
        updatedAt: event.updatedAt,
      });
      updatePinnedMessage(event.messageId, { content: event.content });
    });

    const unsubscribeDeleted = eventBus.on(WS_EVENTS.MESSAGE.DELETED, (event) => {
      if (event.chatId && event.chatId !== chatId) return;
      setMessages((items) => items.filter((message) => message.id !== event.messageId));
    });

    const handleTyping = (event: ITypingEvent) => {
      if (event.chatId !== chatId) return;
      const userId = event.userId || event.senderId;
      if (!userId || userId === currentUser?.id) return;

      setTypingUserId(userId);

      const currentChat = chat?.type === 'private' ? { ...chat } : chat;
      setChat(currentChat);
      window.clearTimeout(typingTimeoutRef.current || undefined);
      typingTimeoutRef.current = window.setTimeout(() => {
        setTypingUserId(null);
      }, 3000);
    };
    const unsubscribeTyping = eventBus.on('typing', handleTyping);
    // const unsubscribeUserTyping = eventBus.on("user_typing", handleTyping);
    const unsubscribePinned = eventBus.on('message_pinned', async (event) => {
      if (event.chatId && event.chatId !== chatId) return;

      const message = await services.messageService.processMessageForDisplay(
        chatId,
        event.pin.message
      );
      const pinned = { ...event.pin, message };
      setPinnedMessages((prev) => [...prev, pinned]);
      services.messageService.addPinnedMessageToCache(chatId, pinned);
    });
    const unsubscribeUnpinned = eventBus.on('message_unpinned', (event) => {
      if (event.chatId && event.chatId !== chatId) return;
      setPinnedMessages((items) => items.filter((item) => item.messageId !== event.messageId));
      services.messageService.removePinnedMessageFromCache(event.messageId);
    });

    return () => {
      unsubscribeNew();
      unsubscribeEdited();
      unsubscribeDeleted();
      unsubscribeTyping();
      // unsubscribeUserTyping();
      unsubscribePinned();
      unsubscribeUnpinned();
      window.clearTimeout(typingTimeoutRef.current || undefined);
    };
  }, [chatId, currentUser?.id, eventBus]);

  function markMessagesAsRead(targetChatId: string, nextMessages: TMessagesList) {
    const messageIds = nextMessages
      .filter((message) => message?.id && message.senderId !== currentUser?.id)
      .map((message) => message.id);
    if (messageIds.length === 0) return;
    services.messageService.markAsRead(targetChatId, messageIds).catch((err) => {
      console.warn('Failed to mark messages as read', err);
    });
  }

  function closePhotoEditor() {
    setPhotoEditorFile(null);

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }

  function handlePhotoEditorSave(file: File) {
    setPendingAttachment({
      file,
      type: 'image',
    });

    setPhotoEditorFile(null);
    setEditingMessage(null);
    setError('');

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }

  const toggleMessageSelection = useCallback(
    (message: IMessageDto) => {
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
    },
    [selectedMessages, setSelectionMode]
  );

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

          <PinnedMessages messages={pinnedMessages} setPinnedMessagesOpen={setPinnedMessagesOpen} />
          <MessagesList
            error={error}
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
              onClose={() =>
                setProfileModal({
                  isOpen: false,
                  isLoading: false,
                  error: '',
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
