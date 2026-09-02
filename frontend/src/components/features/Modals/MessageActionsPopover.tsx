import { Icon } from '@/components/ui';
import { useMessageActions } from '@/hooks';
import { pinsQuery } from '@/queries/chat/threadQueries';
import { useChatUiStore, useProfileStore } from '@/store';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { IMessageDto, TIconTypes } from '@/types';
import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
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
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { t } = useTranslation();
  const actions = useMessageActions({
    draftRef,
    setIsForwardModalOpen,
  });
  // По селектору на поле: подписка на хранилище целиком перерисовывала бы
  // меню и на то, что его не касается, — правку, ответ, перевод, ошибку
  // отправки.
  const selectedMessages = useChatUiStore((state) => state.selectedMessages);
  const selectionMode = useChatUiStore((state) => state.selectionMode);
  const actionMenu = useChatUiStore((state) => state.actionMenu);
  // Закреплённые живут в кеше запросов: меню должно знать, закреплено ли
  // сообщение, чтобы показать «Закрепить» или «Открепить».
  const { data: pinnedMessages = [] } = useQuery(pinsQuery(chatId));

  const mine = message.senderId === currentUser?.id;
  const isPinned = pinnedMessages.some((p) => p.messageId === message.id);
  const isSelected = selectedMessages.some((m) => m.id === message.id);

  // Список пересобирается только когда меняется то, от чего он зависит:
  // само сообщение, режим выделения и признак закрепления. Иначе десяток
  // объектов с переведёнными подписями создавался бы на каждый рендер.
  const buttons: IActionButton[] = useMemo(
    () => [
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
      // Закрепление и открепление отличаются только подписью: в режиме
      // выделения действие применяется ко всем отмеченным, поэтому
      // «Закрепить всё».
      {
        show: !isPinned,
        icon: 'pin',
        key: 'pin',
        def: selectionMode
          ? t('messageActions.pinAll', 'Закрепить всё')
          : t('messageActions.pin', 'Закрепить'),
        action: () => actions.handlePinMessage(message),
      },
      {
        show: isPinned,
        icon: 'pin',
        key: 'unpin',
        def: selectionMode
          ? t('messageActions.unpinAll', 'Открепить всё')
          : t('messageActions.unpin', 'Открепить'),
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
    ],
    [actions, isPinned, message, mine, selectionMode, t]
  );

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
              <Icon name={b.icon} className="fill-transparent" />
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
