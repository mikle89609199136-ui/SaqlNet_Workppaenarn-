import { Button, Icon } from '@/shared/ui';
import { useEscapeKey } from '@/shared/lib';
import { useChatUiStore } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { canForwardMessage, canTranslateMessage } from '@/features/message-actions';
import { useTranslation } from 'react-i18next';
import { ComposerRow } from './ComposerRow';
import { ComposerWrapper } from './ComposerWrapper';

interface Props {
  handleCancelSelection: () => void;
  onForwardMessage: () => void;
  onCopyMessage: () => void;
  onTranslateMessage?: () => void;
  /** Открывает подтверждение удаления — общее для чата (#840). */
  onDeleteMessage: () => void;
}

/**
 * Панель действий над выбранными сообщениями (мультивыбор).
 * Реализована на дизайн-системе (компонент Button), поддерживает сброс по
 * Escape и адаптивную верстку для мобильных устройств. Подтверждение
 * удаления — общий диалог чата (DeleteMessagesDialog, #840).
 */
export const ChatSelectedMessagesActions = ({
  handleCancelSelection,
  onCopyMessage,
  onDeleteMessage,
  onForwardMessage,
  onTranslateMessage,
}: Props) => {
  const { t } = useTranslation();
  const selectedMessages = useChatUiStore((state) => state.selectedMessages);
  const selectedCount = selectedMessages.length;
  const currentUserId = useProfileStore((state) => state.user?.id);
  // Пересылается всё отмеченное одной пачкой: если среди него звонок или
  // вложение, которое не открылось, кнопки нет (#1061).
  const canForward = selectedMessages.every(canForwardMessage);
  // Перевод доступен, если среди выбранных есть хотя бы одно входящее текстовое сообщение (#1085).
  const canTranslate = selectedMessages.some((m) => canTranslateMessage(m, currentUserId));

  const isConfirmOpen = useChatUiStore((state) =>
    Boolean(state.deleteTargets || state.translatorConsentRequest)
  );

  // Клавиша Escape сбрасывает выбор, когда диалог подтверждения закрыт
  useEscapeKey({ active: !isConfirmOpen, onClose: handleCancelSelection });

  return (
    <>
      <ComposerWrapper>
        <ComposerRow className="@container justify-between items-center gap-2 flex-nowrap">
          <div className="flex items-center gap-1.5 flex-nowrap min-w-0 overflow-x-auto scrollbar-none">
            {/* Счетчик выбранных сообщений */}
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-control bg-sheet-2 text-ink text-caption font-semibold select-none mr-1 shrink-0">
              <span className="text-ink-2">{t('selected', 'Выбрано')}:</span>
              <span data-testid="selected-count">{selectedCount}</span>
            </div>

            {canForward && (
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
                <span className="hidden @xl:inline">{t('forward', 'Переслать')}</span>
              </Button>
            )}

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
              <span className="hidden @xl:inline">{t('copy', 'Скопировать')}</span>
            </Button>

            {canTranslate && onTranslateMessage && (
              <Button
                aria-label={t('action.translate', 'Перевести')}
                className="shrink-0"
                disabled={selectedCount === 0}
                onClick={onTranslateMessage}
                size="sm"
                title={t('action.translate', 'Перевести')}
                type="button"
                variant="ghost"
              >
                <Icon name="language" size="sm" />
                <span className="hidden @xl:inline">{t('action.translate', 'Перевести')}</span>
              </Button>
            )}

            <Button
              aria-label={t('delete', 'Удалить')}
              className="shrink-0"
              disabled={selectedCount === 0}
              onClick={onDeleteMessage}
              size="sm"
              title={t('delete', 'Удалить')}
              type="button"
              variant="danger"
            >
              <Icon name="trash" size="sm" />
              <span className="hidden @xl:inline">{t('delete', 'Удалить')}</span>
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
            <Icon name="cross" size="sm" className="@sm:hidden" />
            <span className="hidden @sm:inline">{t('cancel', 'Отмена')}</span>
          </Button>
        </ComposerRow>
      </ComposerWrapper>
    </>
  );
};
