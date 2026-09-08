import { ChatThreadHeader, MessageActionsPopover, MessagesList } from '../ChatThread';
import { Button, ConfirmDialog } from '@/shared/ui';
import { useToasts } from '@/hooks';
import { services } from '@/services/serviceContainer';
import { type IActionMenu } from '@/store';
import type { IMessageDto, IPinnedDto, TPinnedList } from '@/types';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

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
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { showToast } = useToasts();
  const [isUnpinAllOpen, setIsUnpinAllOpen] = useState(false);
  const [isUnpinning, setIsUnpinning] = useState(false);

  // Закрывать страницу закреплений, когда закреплений не осталось
  useEffect(() => {
    if (!isLoading && pinnedMessages.length === 0) {
      onClose();
    }
  }, [isLoading, pinnedMessages.length, onClose]);

  const handleUnpinAllMessages = async () => {
    if (!pinnedMessages.length) return;
    setIsUnpinning(true);
    try {
      const results = await Promise.allSettled(
        pinnedMessages.map((pinned) =>
          services.messageService.unpinMessage(chatId, pinned.messageId)
        )
      );

      const rejected = results.filter((result) => result.status === 'rejected');
      if (rejected.length > 0) {
        showToast('error', t('messageUnpinError', 'Не удалось открепить сообщение'));
      }
      setIsUnpinAllOpen(false);
      setPinnedMessagesOpen(false);
    } catch {
      showToast('error', t('messageUnpinError', 'Не удалось открепить сообщение'));
    } finally {
      setIsUnpinning(false);
    }
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
        <MessageActionsPopover
          message={selectedActionMessage.message}
          onSelection={onSelection}
          setIsForwardModalOpen={setIsForwardModalOpen}
        />
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
            onClick={() => setIsUnpinAllOpen(true)}
            className="w-full"
          >
            {t('unpinAll', 'Открепить всё')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={isUnpinAllOpen}
        title={t('unpinAllConfirmTitle', 'Открепить все сообщения?')}
        confirmLabel={t('unpinAll', 'Открепить всё')}
        danger
        confirming={isUnpinning}
        onConfirm={handleUnpinAllMessages}
        onCancel={() => setIsUnpinAllOpen(false)}
      >
        {t('unpinAllConfirm', 'Закрепления пропадут у всех участников чата.')}
      </ConfirmDialog>
    </main>
  );
};
