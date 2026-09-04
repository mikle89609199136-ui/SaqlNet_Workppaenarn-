import { Button, ConfirmDialog, Icon } from '@/components/ui';
import { useEscapeKey, useIsMobile } from '@/hooks';
import { useChatUiStore } from '@/store';
import type { IMessageDto } from '@/types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ComposerRow, ComposerWrapper } from '../ChatComposer';

interface Props {
  handleCancelSelection: () => void;
  onForwardMessage: () => void;
  onCopyMessage: () => void;
  onDeleteMessage: () => Promise<void> | void;
  selectedMessages?: IMessageDto[];
}

/**
 * Панель действий над выбранными сообщениями (мультивыбор).
 * Реализована на дизайн-системе (компонент Button), поддерживает
 * подтверждение удаления через ConfirmDialog, сброс по Escape и
 * адаптивную верстку для мобильных устройств.
 */
export const ChatSelectedMessagesActions = ({
  handleCancelSelection,
  onCopyMessage,
  onDeleteMessage,
  onForwardMessage,
  selectedMessages: propSelectedMessages,
}: Props) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const storeSelected = useChatUiStore((state) => state.selectedMessages);
  const selectedMessages = propSelectedMessages ?? storeSelected;
  const selectedCount = selectedMessages.length;

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Клавиша Escape сбрасывает выбор, когда диалог подтверждения закрыт
  useEscapeKey({ active: !isConfirmOpen, onClose: handleCancelSelection });

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDeleteMessage();
      setIsConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <ComposerWrapper>
        <ComposerRow className="justify-between items-center gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Счетчик выбранных сообщений */}
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-control bg-sheet-2 text-ink text-caption font-semibold select-none mr-1">
              <span className="text-ink-2">{t('selected', 'Выбрано')}:</span>
              <span data-testid="selected-count">{selectedCount}</span>
            </div>

            <Button
              aria-label={t('forward', 'Переслать')}
              disabled={selectedCount === 0}
              onClick={onForwardMessage}
              size="sm"
              title={t('forward', 'Переслать')}
              type="button"
              variant="ghost"
            >
              <Icon name="forward" size="sm" />
              {!isMobile && <span>{t('forward', 'Переслать')}</span>}
            </Button>

            <Button
              aria-label={t('copy', 'Скопировать')}
              disabled={selectedCount === 0}
              onClick={onCopyMessage}
              size="sm"
              title={t('copy', 'Скопировать')}
              type="button"
              variant="ghost"
            >
              <Icon name="copy" size="sm" />
              {!isMobile && <span>{t('copy', 'Скопировать')}</span>}
            </Button>

            <Button
              aria-label={t('delete', 'Удалить')}
              disabled={selectedCount === 0}
              onClick={() => setIsConfirmOpen(true)}
              size="sm"
              title={t('delete', 'Удалить')}
              type="button"
              variant="danger"
            >
              <Icon name="trash" size="sm" />
              {!isMobile && <span>{t('delete', 'Удалить')}</span>}
            </Button>
          </div>

          <Button
            aria-label={t('cancel', 'Отмена')}
            onClick={handleCancelSelection}
            size="sm"
            title={t('cancel', 'Отмена')}
            type="button"
            variant="ghost"
          >
            <span>{t('cancel', 'Отмена')}</span>
          </Button>
        </ComposerRow>
      </ComposerWrapper>

      {/* Диалог подтверждения удаления выбранных сообщений */}
      {isConfirmOpen && (
        <ConfirmDialog
          cancelLabel={t('cancel', 'Отмена')}
          confirmLabel={t('delete', 'Удалить')}
          confirming={isDeleting}
          danger
          onCancel={() => setIsConfirmOpen(false)}
          onConfirm={handleConfirmDelete}
          open={isConfirmOpen}
          title={t('deleteSelectedTitle', 'Удалить выбранные сообщения?')}
        >
          <p className="text-sm text-ink-2">
            {t(
              'deleteSelectedConfirm',
              'Вы уверены, что хотите удалить выбранные сообщения ({{count}} шт.)? Это действие нельзя отменить.',
              { count: selectedCount }
            )}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
};
