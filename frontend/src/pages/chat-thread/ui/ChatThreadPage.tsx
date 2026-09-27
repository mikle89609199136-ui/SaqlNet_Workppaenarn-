import { ChatThreadHeader, SafetyCodeNotice } from '@/widgets/chat-header';
import { MessagesList } from '@/widgets/chat-messages';
import { BlockUserButton, NewChatBanner } from '@/features/block-user';
import type { IProfileActionsTarget } from '@/features/user-profile';
import { ChatThreadComposer, ChatSelectedMessagesActions } from '@/widgets/chat-composer';
import { PinnedMessagesView } from '@/widgets/pinned-messages';
import { ForwardChatMessagesModal } from '@/features/forward-messages';
import { GroupInfoModal } from '@/features/group-management';
import { MessageActionsPopover } from '@/features/message-actions';
import { PinnedMessagesNavigator } from '@/features/pinned-messages';
import { UserProfileModal } from '@/features/user-profile';
import { PhotoEditorModal } from '@/entities/media';

import { useOutletContext } from 'react-router-dom';

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatThreadPage } from '../hooks/useChatThreadPage';

import type { IProfileState } from '@/entities/user';

/* Действия с чужим профилем — блокировка (#727). На уровне модуля:
   стабильная ссылка не перерисовывает мемоизированную панель. */
const renderProfileActions = ({ id, name }: IProfileActionsTarget) => (
  <BlockUserButton className="w-full py-3 text-ui font-medium" name={name} userId={id} />
);

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

  // Автор пересланного сообщения (#785). Стабильная ссылка: пузыри
  // мемоизированы и не должны перерисовываться всей лентой.
  const openProfile = useCallback(
    (userId: string) => setProfileModal({ isOpen: true, userId }),
    [setProfileModal]
  );

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
          <ChatThreadHeader setProfileModal={setProfileModal} profileModal={profileModal} />

          <PinnedMessagesNavigator
            messages={pinnedMessages}
            setPinnedMessagesOpen={modals.setPinnedMessagesOpen}
          />
          {/* Новый чат от незнакомого: заблокировать или пожаловаться (#465). */}
          {chat && (
            <NewChatBanner chat={chat} hasOlder={hasOlder} key={chat.id} messages={messages} />
          )}
          <MessagesList
            bottomRef={bottomRef}
            error={threadError}
            hasOlder={hasOlder}
            isGroupChat={chat?.type === 'group'}
            isLoading={isLoading}
            loadOlder={loadOlder}
            messages={messages}
            messagesRef={messagesRef}
            onCancelMessage={handleCancelMessage}
            onOpenProfile={openProfile}
            onReact={handleReact}
            onRetryMessage={handleRetryMessage}
            setOpenedImage={modals.setOpenedImage}
            showDeliveryStatus={chat?.type === 'private'}
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

          {profileMode === 'modal' && chat?.type === 'group' && (
            <GroupInfoModal
              isOpen={profileModal.isOpen && profileModal.kind === 'group'}
              onClose={() => setProfileModal({ isOpen: false, userId: null })}
            />
          )}

          {profileMode === 'modal' && profileModal.kind !== 'group' && (
            <UserProfileModal
              onClose={() => setProfileModal({ isOpen: false, userId: null })}
              profileModal={profileModal}
              renderActions={renderProfileActions}
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
