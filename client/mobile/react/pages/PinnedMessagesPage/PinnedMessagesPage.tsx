import { ChatThreadHeader, MessageActionsPopover } from '@/components/components';
import { ComposerWrapper, MessagesList } from '@/components/ui';
import { useMessageActions } from '@/hooks';
import { type IActionMenu } from '@/store';
import type { IMessageDto, IPinnedDto, TPinnedList } from '@/types';
import { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  pinnedMessages: TPinnedList;
  onClose: () => void;
  isLoading: boolean;
  error: string;
  openedImage: string | null;
  setOpenedImage: Dispatch<SetStateAction<string | null>>;
  onSelection: (message: IMessageDto) => void;
  actionMenu: IActionMenu | null;
  setIsForwardModalOpen: Dispatch<SetStateAction<boolean>>;
  setPinnedMessagesOpen: Dispatch<SetStateAction<boolean>>;
}

export const PinnedMessagesPage = ({
  pinnedMessages,
  onClose,
  isLoading,
  error,
  openedImage,
  setOpenedImage,
  onSelection,
  actionMenu,
  setIsForwardModalOpen,
  setPinnedMessagesOpen,
}: Props) => {
  const { t } = useTranslation();
  const { handleUnpinMessage } = useMessageActions({
    setIsForwardModalOpen,
  });

  const handleUnpinAllMessages = () => {
    for (const pinned of pinnedMessages) {
      handleUnpinMessage(pinned.message);
    }
    setPinnedMessagesOpen(false);
  };

  const selectedActionMessage = actionMenu
    ? pinnedMessages.find((message: IPinnedDto) => message.messageId === actionMenu.messageId)
    : null;

  return (
    <main className="thread-page">
      <ChatThreadHeader locationPage="pinned-messages" onClosePinnedMessagePage={onClose} />

      <MessagesList
        error={error}
        isLoading={isLoading}
        messages={pinnedMessages.map((pinned) => pinned.message)}
        setOpenedImage={setOpenedImage}
        toggleMessageSelection={onSelection}
      />

      {actionMenu && selectedActionMessage && (
        <>
          <div aria-hidden="true" className="message-actions-backdrop" />
          <MessageActionsPopover
            message={selectedActionMessage.message}
            onSelection={onSelection}
            setIsForwardModalOpen={setIsForwardModalOpen}
          />
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

      <ComposerWrapper>
        <button
          type="button"
          onClick={handleUnpinAllMessages}
          className="flex items-center gap-x-1 w-full px-3 bg-transparent text-[rgba(255,255,255,0.85)] font-normal hover:backdrop-blur-md rounded-4xl justify-center"
        >
          <span>{t('unpinAll', 'Открепить всё')}</span>
        </button>
      </ComposerWrapper>
    </main>
  );
};
