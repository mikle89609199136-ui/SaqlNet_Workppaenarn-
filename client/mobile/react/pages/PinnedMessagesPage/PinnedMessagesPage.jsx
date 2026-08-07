import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { MessageBubble } from "../../components/components/MessageBubble/MessageBubble";
import { MessageActionsPopover } from "../../components/components/Modals/MessageActionsPopover";
import { ThreadSkeleton } from "../../components/ui/Skeletons/ThreadSkeleton";
import { ThreadState } from "../../components/ui/ThreadState";
import { useChatStore } from "../../store/chat";

export const PinnedMessagesPage = forwardRef(
  (
    {
      pinnedMessages,
      onClose,
      isLoading,
      error,
      openedImage,
      onOpenImage,
      onSelection,
      actionMenu,
      currentUser,
      setIsForwardModalOpen,
      updateMessage,
      handleUnpinMessage,
      setPinnedMessagesOpen
    },
    draftRef,
  ) => {
    const { chatId } = useParams();
    const chat = useChatStore((state) => state.chat);
    const setSelectedMessages = useChatStore((state) => state.setSelectedMessages);
    const { t } = useTranslation();
    const { translations } = useChatStore();

    const handleUnpinAllMessages = () => {
      for (const pinned of pinnedMessages) {
        handleUnpinMessage(pinned.message)
      }
      setPinnedMessagesOpen(false);
    }

    const selectedActionMessage = actionMenu
      ? pinnedMessages.find(
          (message) => message.messageId === actionMenu.messageId,
        )
      : null;
    console.log(selectedActionMessage)
    return (
      <main className="thread-page">
        <header className="thread-header">
          <button
            aria-label={t("back", "Назад")}
            className="pinned-thread-back"
            onClick={onClose}
          >
            <svg
              fill="none"
              className="size-6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="3 0 20 22"
            >
              <line x1="19" x2="5" y1="12" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>

          <div className="thread-header-card pinned-thread-header-info p-3">
            {t("pinnedMessagesTitle", "Закрепленные сообщения")}
          </div>
        </header>

        <section className="thread-messages">
          {isLoading && <ThreadSkeleton />}
          {!isLoading && error && pinnedMessages.length === 0 && (
            <ThreadState
              message={error}
              title={t("loadingError", "Ошибка загрузки")}
            />
          )}
          {!isLoading && !error && pinnedMessages.length === 0 && (
            <ThreadState
              message={t(
                "emptyThreadDescription",
                "Напишите первое сообщение в этом чате.",
              )}
              title={t("emptyThread", "Сообщений пока нет")}
            />
          )}
          {pinnedMessages.map(({ message, messageId }) => {
            return (
              <MessageBubble
                currentUserId={currentUser.id}
                key={messageId}
                message={message}
                translations={translations}
                onOpenImage={onOpenImage}
                onSelection={onSelection}
              />
            );
          })}
        </section>

        {actionMenu && selectedActionMessage && (
          <>
            <div aria-hidden="true" className="message-actions-backdrop" />
            <MessageActionsPopover
              message={selectedActionMessage.message}
              onSelection={onSelection}
              currentUser={currentUser}
              chatId={chatId}
              draftRef={draftRef}
              chatType={chat?.type}
              chatRole={chat?.role}
              updateMessage={updateMessage}
              setIsForwardModalOpen={setIsForwardModalOpen}
            />
            {openedImage && (
              <div
                aria-label={t("imageViewer", "Просмотр изображения")}
                aria-modal="true"
                className="image-viewer"
                onClick={() => setOpenedImage(null)}
                role="dialog"
              >
                <button
                  aria-label={t("close", "Закрыть")}
                  className="image-viewer-close"
                  onClick={() => setOpenedImage(null)}
                  type="button"
                >
                  ×
                </button>
                <img
                  alt=""
                  onClick={(event) => event.stopPropagation()}
                  src={openedImage}
                />
              </div>
            )}
            {openedImage && (
              <div
                aria-label={t("imageViewer", "Просмотр изображения")}
                aria-modal="true"
                className="image-viewer"
                onClick={() => setOpenedImage(null)}
                role="dialog"
              >
                <button
                  aria-label={t("close", "Закрыть")}
                  className="image-viewer-close"
                  onClick={() => setOpenedImage(null)}
                  type="button"
                >
                  ×
                </button>
                <img
                  alt=""
                  onClick={(event) => event.stopPropagation()}
                  src={openedImage}
                />
              </div>
            )}
          </>
        )}

        {openedImage && (
          <div
            aria-label={t("imageViewer", "Просмотр изображения")}
            aria-modal="true"
            className="image-viewer"
            onClick={() => onOpenImage(null)}
            role="dialog"
          >
            <button
              aria-label={t("close", "Закрыть")}
              className="image-viewer-close"
              onClick={() => onOpenImage(null)}
              type="button"
            >
              ×
            </button>
            <img
              alt=""
              onClick={(event) => event.stopPropagation()}
              src={openedImage}
            />
          </div>
        )}

        <form className="thread-composer">
          <div className="thread-composer-card">
            <button
              type="button"
              onClick={handleUnpinAllMessages}
              className="flex items-center gap-x-1 w-full px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl justify-center"
            >
              <span>{t("unpinAll", "Открепить всё")}</span>
            </button>
          </div>
        </form>
      </main>
    );
  },
);
