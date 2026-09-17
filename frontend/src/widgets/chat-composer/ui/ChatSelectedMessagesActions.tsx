import { Button, ConfirmDialog, Icon, showToast } from '@/shared/ui';
import { useEscapeKey, useIsMobile } from '@/shared/lib';
import { useChatUiStore } from '@/store';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ComposerRow } from './ComposerRow';
import { ComposerWrapper } from './ComposerWrapper';

interface Props {
  handleCancelSelection: () => void;
  onForwardMessage: () => void;
  onCopyMessage: () => void;
  onDeleteMessage: () => Promise<void> | void;
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
}: Props) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const selectedMessages = useChatUiStore((state) => state.selectedMessages);
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
    } catch {
      showToast('error', t('messageDeleteError', 'Не удалось удалить сообщение(я)'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <ComposerWrapper>
        <ComposerRow className="justify-between items-center gap-2 flex-nowrap">
          <div className="flex items-center gap-1.5 flex-nowrap shrink-0 min-w-0">
            {/* Счетчик выбранных сообщений */}
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-control bg-sheet-2 text-ink text-caption font-semibold select-none mr-1 shrink-0">
              <span className="text-ink-2">{t('selected', 'Выбрано')}:</span>
              <span data-testid="selected-count">{selectedCount}</span>
            </div>

            <Button
              aria-label={t('forward', 'Переслать')}
              className="shrink-0"
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
              className="shrink-0"
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
              className="shrink-0"
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
            className="shrink-0"
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
          {t('deleteSelectedConfirm', 'Сообщения удалятся у всех участников. {{count}} шт.', {
            count: selectedCount,
          })}
        </p>
      </ConfirmDialog>
    </>
  );
};
