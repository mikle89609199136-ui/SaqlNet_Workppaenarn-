import { useQuery, useQueryClient } from '@tanstack/react-query';
import { chatKeys, chatQuery } from '@/entities/chat';
import { patchThreadMessage } from '@/entities/message';
import { ChatThreadHeader } from '@/widgets/chat-header';
import { MessagesList } from '@/widgets/chat-messages';
import { MessageActionsPopover, useMessageActions } from '@/features/message-actions';
import { Button, ConfirmDialog, showToast } from '@/shared/ui';
import { services } from '@/services/serviceContainer';
import { type IActionMenu } from '@/entities/chat';
import type { IMessageDto, IPinnedDto, TPinnedList, TMessagesList } from '@/types';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

interface Props {
  pinnedMessages: TPinnedList;
  /** Сообщения истории чата для разрешения цитируемых сообщений (#1084). */
  threadMessages?: TMessagesList;
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
  threadMessages,
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
  const { handleReact } = useMessageActions({ setIsForwardModalOpen });
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { data: chat } = useQuery(chatQuery(chatId));
  const client = useQueryClient();
  const canShare = chat?.type === 'private' || chat?.role === 'owner' || chat?.role === 'admin';
  const canUnpinAny = canShare || pinnedMessages.some((pin) => pin.message.isPersonalPinned);
  const [isUnpinAllOpen, setIsUnpinAllOpen] = useState(false);
  const [isUnpinning, setIsUnpinning] = useState(false);

  // Закрывать страницу закреплений, когда закреплений не осталось
  useEffect(() => {
    if (!isLoading && !error && pinnedMessages.length === 0) {
      onClose();
    }
  }, [isLoading, error, pinnedMessages.length, onClose]);

  const handleUnpinAllMessages = async () => {
    if (!pinnedMessages.length) return;
    setIsUnpinning(true);
    try {
      const results = await Promise.allSettled(
        pinnedMessages.flatMap((pinned) => {
          const scopes: ('chat' | 'personal')[] = [];
          if (pinned.message.isPersonalPinned) scopes.push('personal');
          if (
            canShare &&
            (pinned.message.isChatPinned ??
              (!pinned.message.isPersonalPinned || pinned.message.isPinned))
          )
            scopes.push('chat');
          return scopes.map(async (scope) => {
            await services.messageService.unpinMessage(chatId, pinned.messageId, scope);
            patchThreadMessage(
              client,
              chatId,
              pinned.messageId,
              scope === 'personal'
                ? { isPersonalPinned: false }
                : { isPinned: false, isChatPinned: false }
            );
            await client.invalidateQueries({
              queryKey:
                scope === 'personal' ? chatKeys.personalPins(chatId) : chatKeys.pins(chatId),
            });
          });
        })
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
        chatId={chatId}
        onReact={handleReact}
        error={error}
        isLoading={isLoading}
        messages={pinnedMessages.map((pinned) => pinned.message)}
        setOpenedImage={setOpenedImage}
        threadMessages={threadMessages}
        toggleMessageSelection={onSelection}
        trackUnread={false}
      />

      {actionMenu && selectedActionMessage && (
        <MessageActionsPopover
          message={selectedActionMessage.message}
          onSelection={onSelection}
          place="pinned"
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

      {pinnedMessages.length > 0 && canUnpinAny && (
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
        {t(
          'pinDialog.unpinAllHint',
          'Личные закрепления исчезнут только у вас; общие — у всех, если у вас есть права. Собеседники сохранят свои личные закрепления.'
        )}
      </ConfirmDialog>
    </main>
  );
};
