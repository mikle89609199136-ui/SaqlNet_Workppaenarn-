import { Icon } from '@/components/ui';
import { useMessageActions } from '@/hooks';
import { useChatStore, useProfileStore } from '@/store';
import type { IMessageDto, TIconTypes } from '@/types';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

interface Props {
  message: IMessageDto;
  onSelection: (message: IMessageDto) => void;
  draftRef?: RefObject<HTMLInputElement | null>;
  setIsForwardModalOpen: Dispatch<SetStateAction<boolean>>;
}

interface IActionButton {
  show: boolean;
  icon: TIconTypes;
  key: string;
  def: string;
  action: () => void;
  className?: string;
}

export const MessageActionsPopover = ({
  message,
  onSelection,
  draftRef,
  setIsForwardModalOpen,
}: Props) => {
  const currentUser = useProfileStore((state) => state.user);
  const { t } = useTranslation();
  const actions = useMessageActions({
    draftRef,
    setIsForwardModalOpen,
  });
  const { selectedMessages, pinnedMessages, selectionMode, actionMenu } = useChatStore();

  const mine = message.senderId === currentUser?.id;
  const isPinned = pinnedMessages.some((p) => p.messageId === message.id);
  const isSelected = selectedMessages.some((m) => m.id === message.id);

  const buttons: IActionButton[] = [
    {
      show: !selectionMode,
      icon: 'reply',
      key: 'reply',
      def: t('messageActions.reply', 'Ответить'),
      action: () => actions.startReply(message),
    },
    {
      show: true,
      icon: 'copy',
      key: 'copy',
      def: t('messageActions.copy', 'Скопировать'),
      action: () => actions.handleCopyMessage(message),
    },
    {
      show: !mine && !selectionMode,
      icon: 'language',
      key: 'translate',
      def: t('action.translate', 'Перевести'),
      action: () => actions.handleTranslateMessage(message),
    },
    {
      show: mine && !selectionMode,
      icon: 'edit',
      key: 'edit',
      def: t('messageActions.edit', 'Изменить'),
      action: () => actions.startEdit(message),
    },
    {
      show: !isPinned && !selectionMode,
      icon: 'pin',
      key: 'pin',
      def: t('messageActions.pin', 'Закрепить'),
      action: () => actions.handlePinMessage(message),
    },
    {
      show: !isPinned && selectionMode,
      icon: 'pin',
      key: 'pin',
      def: t('messageActions.pinAll', 'Закрепить всё'),
      action: () => actions.handlePinMessage(message),
    },
    {
      show: isPinned && !selectionMode,
      icon: 'pin',
      key: 'unpin',
      def: t('messageActions.unpin', 'Открепить'),
      action: () => actions.handleUnpinMessage(message),
    },
    {
      show: isPinned && selectionMode,
      icon: 'pin',
      key: 'unpin',
      def: t('messageActions.unpinAll', 'Открепить всё'),
      action: () => actions.handleUnpinMessage(message),
    },
    {
      show: true,
      icon: 'forward',
      key: 'forward',
      def: t('messageActions.forward', 'Переслать'),
      action: () => actions.handleForward(message),
    },
    {
      show: mine,
      icon: 'trash',
      key: 'delete',
      def: t('messageActions.delete', 'Удалить'),
      action: () => actions.handleDelete(message),
      className: 'is-danger',
    },
  ];

  return (
    <div
      className="message-actions-popover"
      onClick={(e) => e.stopPropagation()}
      style={{ left: actionMenu?.x, top: actionMenu?.y }}
    >
      <div className="message-reaction-actions">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => actions.runMessageAction(() => actions.handleReact(message, emoji))}
            type="button"
            className="shrink-0"
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="message-text-actions">
        {buttons
          .filter((b) => b.show)
          .map((b) => (
            <button
              key={b.key}
              className={b.className}
              onClick={() => actions.runMessageAction(b.action)}
              type="button"
            >
              <Icon name={b.icon} className='fill-transparent'/>
              <span>{t(b.key, b.def)}</span>
            </button>
          ))}

        <button
          onClick={() =>
            actions.runMessageAction(() =>
              selectionMode ? onSelection(message) : actions.startSelection(message)
            )
          }
          type="button"
        >
          <Icon name="checkCircle" className="fill-transparent" />
          <span>
            {isSelected ? t('uncheckMessage', 'Снять выбор') : t('checkMessage', 'Выбрать')}
          </span>
        </button>
      </div>
    </div>
  );
};
