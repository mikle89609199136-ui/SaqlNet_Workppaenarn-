import { ChatThreadHeader, ConnectionBanner, SafetyCodeNotice } from '@/widgets/chat-header';
import { MessagesList } from '@/widgets/chat-messages';
import { BlockUserButton, NewChatBanner } from '@/features/block-user';
import type { IProfileActionsTarget, IProfileCall } from '@/features/user-profile';
import { ChatThreadComposer, ChatSelectedMessagesActions } from '@/widgets/chat-composer';
import { PinnedMessagesView } from '@/widgets/pinned-messages';
import { ForwardChatMessagesModal } from '@/features/forward-messages';
import { GroupInfoModal } from '@/widgets/group-info';
import { useCall } from '@/features/call';
import { CALLS_ENABLED } from '@/shared/config';
import { DeleteMessagesDialog, MessageActionsPopover } from '@/features/message-actions';
import { PinnedMessagesNavigator } from '@/features/pinned-messages';
import { UserProfileModal } from '@/features/user-profile';
import { PhotoEditorModal } from '@/entities/media';

import { useOutletContext } from 'react-router-dom';

import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatThreadPage } from '../hooks/useChatThreadPage';

import { useProfileStore, type IProfileState } from '@/entities/user';

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
  /* Звонок из профиля (#863): профиль о звонках не знает — действие даёт
     страница, пока звонки включены. */
  const { initiateCall } = useCall();
  const startProfileCall = useMemo(
    () =>
      CALLS_ENABLED
        ? ({ chatId, peerId, peerName, kind }: IProfileCall) =>
            initiateCall(chatId, 'private', peerName, kind, peerId)
        : undefined,
    [initiateCall]
  );

  const {
    chatId,
    chat,
    pinnedMessages,
    messages,
    isLoading,
    hasOlder,
    loadOlder,
    readMark,
    markMessagesAsRead,
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
    confirmDelete,
    handleForward,
    handleCloseForwardModal,
    handleRetryMessage,
    handleCancelMessage,
  } = useChatThreadPage({ onProfileStateChange, profileCloseToken, profileMode });

  const currentUserId = useProfileStore((state) => state.user?.id);

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
          {/* Нет связи или идёт переподключение — плашкой под шапкой (#826). */}
          <ConnectionBanner />

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
            handleJumpRequests
            hasOlder={hasOlder}
            isGroupChat={chat?.type === 'group'}
            isLoading={isLoading}
            loadOlder={loadOlder}
            messages={messages}
            messagesRef={messagesRef}
            onCancelMessage={handleCancelMessage}
            onMessagesSeen={markMessagesAsRead}
            onOpenProfile={openProfile}
            onReact={handleReact}
            onRetryMessage={handleRetryMessage}
            readMark={readMark}
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
                showReceipt={chat?.type === 'private'}
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
              pendingAttachments={modals.pendingAttachments}
              setPendingAttachments={modals.setPendingAttachments}
              selectionMode={selectionMode}
              bottomRef={bottomRef}
              attachmentInputRef={attachmentInputRef}
              draftRef={draftRef}
              setPhotoEditorFile={modals.setPhotoEditorFile}
              setOpenedImage={modals.setOpenedImage}
            />
          )}
          {/* Подтверждение удаления — одно на чат: из меню и из выбора (#840). */}
          <DeleteMessagesDialog
            currentUserId={currentUserId}
            isGroup={chat?.type === 'group'}
            onConfirm={confirmDelete}
          />
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
              startCall={startProfileCall}
            />
          )}

          {profileMode === 'modal' && profileModal.kind !== 'group' && (
            <UserProfileModal
              onClose={() => setProfileModal({ isOpen: false, userId: null })}
              profileModal={profileModal}
              renderActions={renderProfileActions}
              startCall={startProfileCall}
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
