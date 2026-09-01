import { ChatThreadHeader } from '../ChatThreadHeader';
import { MessageActionsPopover } from '../Modals/MessageActionsPopover';
import { Button } from '@/components/ui';
import { MessagesList } from '../MessagesList';
import { useMessageActions } from '@/hooks';
import { type IActionMenu } from '@/store';
import type { IMessageDto, IPinnedDto, TPinnedList } from '@/types';
import { useEffect, type Dispatch, type SetStateAction } from 'react';
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

export const PinnedMessagesView = ({
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

  // Закрывать страницу закреплений, когда закреплений не осталось
  useEffect(() => {
    if (!isLoading && pinnedMessages.length === 0) {
      onClose();
    }
  }, [isLoading, pinnedMessages.length, onClose]);

  const handleUnpinAllMessages = () => {
    if (!pinnedMessages.length) return;
    const confirmed = window.confirm(
      t('unpinAllConfirm', 'Вы уверены, что хотите открепить все сообщения?')
    );
    if (!confirmed) return;

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

      {pinnedMessages.length > 0 && (
        <div className="p-3 bg-panel border-t border-line flex shrink-0">
          <Button
            type="button"
            variant="danger"
            size="md"
            onClick={handleUnpinAllMessages}
            className="w-full"
          >
            {t('unpinAll', 'Открепить всё')}
          </Button>
        </div>
      )}
    </main>
  );
};
