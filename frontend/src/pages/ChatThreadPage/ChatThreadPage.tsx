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

import '@/styles/ChatThreadPage.css';
import { useOutletContext } from 'react-router-dom';

import type { IChatDto, TMessagesList } from '@/types';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatThreadPage } from './hooks/useChatThreadPage';

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

export function ChatThreadPage() {
  const { onProfileStateChange, profileCloseToken, profileMode } =
    useOutletContext<IOutletContext>();
  const { t } = useTranslation();

  const {
    chatId,
    chat,
    pinnedMessages,
    messages,
    isLoading,
    hasOlder,
    loadOlder,
    threadError,
    selectedMessages,
    setSelectedMessages,
    selectionMode,
    setSelectionMode,
    actionMenu,

    bottomRef,
    attachmentInputRef,
    draftRef,
    messagesRef,

    modals,
    closePhotoEditor,
    handlePhotoEditorSave,

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
  } = useChatThreadPage({ onProfileStateChange, profileCloseToken, profileMode });

  return (
    <>
      {modals.isForwardModalOpen && (
        <ForwardChatMessagesModal
          messages={selectedMessages}
          onClose={handleCloseForwardModal}
          setSelectedMessages={setSelectedMessages}
          setSelectionMode={setSelectionMode}
        />
      )}
      {modals.isPinnedMessagesOpen && (
        <PinnedMessagesView
          pinnedMessages={pinnedMessages}
          onClose={() => modals.setPinnedMessagesOpen(false)}
          isLoading={isLoading}
          error={threadError}
          openedImage={modals.openedImage}
          setOpenedImage={modals.setOpenedImage}
          onSelection={toggleMessageSelection}
          actionMenu={actionMenu}
          setIsForwardModalOpen={modals.setIsForwardModalOpen}
          setPinnedMessagesOpen={modals.setPinnedMessagesOpen}
        />
      )}
      {!modals.isPinnedMessagesOpen && (
        <main className="thread-page">
          <ChatThreadHeader
            setIsGroupInfoOpen={modals.setIsGroupInfoOpen}
            setProfileModal={setProfileModal}
            profileModal={profileModal}
          />

          <PinnedMessagesNavigator
            messages={pinnedMessages}
            setPinnedMessagesOpen={modals.setPinnedMessagesOpen}
          />
          <MessagesList
            bottomRef={bottomRef}
            error={threadError}
            hasOlder={hasOlder}
            isLoading={isLoading}
            loadOlder={loadOlder}
            messages={messages}
            messagesRef={messagesRef}
            onCancelMessage={handleCancelMessage}
            onReact={handleReact}
            onRetryMessage={handleRetryMessage}
            setOpenedImage={modals.setOpenedImage}
            toggleMessageSelection={toggleMessageSelection}
          />

          {actionMenu && selectedActionMessage && (
            <>
              <MessageActionsPopover
                message={selectedActionMessage}
                onSelection={toggleMessageSelection}
                draftRef={draftRef}
                setIsForwardModalOpen={modals.setIsForwardModalOpen}
              />
            </>
          )}

          {modals.openedImage && (
            <div
              aria-label={t('imageViewer', 'Просмотр изображения')}
              aria-modal="true"
              className="image-viewer"
              onClick={() => modals.setOpenedImage(null)}
              role="dialog"
            >
              <button
                aria-label={t('close', 'Закрыть')}
                className="image-viewer-close"
                onClick={() => modals.setOpenedImage(null)}
                type="button"
              >
                ×
              </button>
              <img alt="" onClick={(event) => event.stopPropagation()} src={modals.openedImage} />
            </div>
          )}

          <SafetyCodeNotice chatId={chatId} />

          {/* Отказ показывается у составителя, а не в ленте: там он виден
              только в пустом чате, и в переписке с историей сообщение
              молча не отправлялось — человек узнавал об этом, лишь
              заметив, что его слов нет. Стиль для плашки существовал,
              но в разметке её не было. */}
          {threadError && messages.length > 0 && (
            <div className="thread-inline-error" role="alert">
              {threadError}
            </div>
          )}

          {!selectionMode && (
            <ChatThreadComposer
              pendingAttachment={modals.pendingAttachment}
              setPendingAttachment={modals.setPendingAttachment}
              selectionMode={selectionMode}
              bottomRef={bottomRef}
              attachmentInputRef={attachmentInputRef}
              draftRef={draftRef}
              setPhotoEditorFile={modals.setPhotoEditorFile}
              setOpenedImage={modals.setOpenedImage}
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
            <GroupInfoModal
              isOpen={modals.isGroupInfoOpen}
              onClose={() => modals.setIsGroupInfoOpen(false)}
            />
          )}

          {profileMode === 'modal' && (
            <UserProfileModal
              onClose={() => setProfileModal({ isOpen: false, userId: null })}
              profileModal={profileModal}
            />
          )}

          {modals.photoEditorFile && (
            <PhotoEditorModal
              file={modals.photoEditorFile}
              onCancel={closePhotoEditor}
              onSave={handlePhotoEditorSave}
            />
          )}
        </main>
      )}
    </>
  );
}
