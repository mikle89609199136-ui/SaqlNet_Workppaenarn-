import type { IRichTextInputHandle } from '@/shared/ui';
import { ContextMenu, Icon, NotoEmoji } from '@/shared/ui';
import { QUICK_REACTIONS } from '@/shared/config';
import { cn } from '@/shared/lib';
import { useMessageActions } from '../model/useMessageActions';
import { pinsQuery } from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { useChatUiStore } from '@/entities/chat';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { IMessageDto, TIconTypes } from '@/types';
import { useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * Быстрая реакция в меню — по макету (#824): картинка Noto 28px в круглой
 * кнопке 34px. При наведении и фокусе увеличивается и проигрывает
 * анимацию; анимация грузится только тогда. Поставленная — на подложке
 * акцента.
 */
function ReactionPick({
  emoji,
  label,
  chosen,
  onPick,
}: {
  emoji: string;
  label: string;
  chosen: boolean;
  onPick: () => void;
}) {
  const [active, setActive] = useState(false);

  return (
    <button
      aria-label={label}
      aria-pressed={chosen}
      className={cn(
        'flex size-8.5 shrink-0 cursor-pointer items-center justify-center rounded-pill transition-transform duration-[120ms] hover:scale-118 focus-visible:scale-118 motion-reduce:transition-none motion-reduce:hover:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        chosen && 'bg-brand-soft'
      )}
      onBlur={() => setActive(false)}
      onClick={onPick}
      // Меню ставит фокус на первую реакцию само — играть она должна только
      // при обходе с клавиатуры, как `:focus-visible` в макете.
      onFocus={(event) => setActive(focusVisible(event.currentTarget))}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      role="menuitem"
      type="button"
    >
      <NotoEmoji animated={active} emoji={emoji} size={28} />
    </button>
  );
}

interface Props {
  message: IMessageDto;
  onSelection: (message: IMessageDto) => void;
  draftRef?: RefObject<IRichTextInputHandle | null>;
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
  const setActionMenu = useChatUiStore((state) => state.setActionMenu);
  // Закреплённые живут в кеше запросов: меню должно знать, закреплено ли
  // сообщение, чтобы показать «Закрепить» или «Открепить».
  const { data: pinnedMessages = [] } = useQuery(pinsQuery(chatId));

  const mine = message.senderId === currentUser?.id;
  const myReaction = message.reactions?.find((reaction) => reaction.myReaction)?.emoji;
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
    <ContextMenu
      aria-label={t('messageActions.title', 'Действия с сообщением')}
      onClose={() => setActionMenu(null)}
      open
      x={actionMenu?.x}
      y={actionMenu?.y}
    >
      {/* Реакции идут рядом, а не столбиком: их шесть, они короткие, и
          выбирают из них глазами, а не по названию. Роль у каждой та же,
          что у обычного пункта, — иначе стрелки перескакивали бы через
          весь ряд. */}
      <div
        aria-label={t('messageActions.reactions', 'Реакции')}
        className="mb-1 flex justify-between border-b border-line px-0.5 pt-0.5 pb-1.75"
        role="group"
      >
        {QUICK_REACTIONS.map(({ emoji, label }) => {
          /* Поставленная реакция видна и в меню, не только на самом
             сообщении: иначе, открыв меню второй раз, не понять, что уже
             отмечено, — а нажатие на неё снимает. */
          const chosen = myReaction === emoji;
          const name = t(label[0], label[1]);

          return (
            <ReactionPick
              chosen={chosen}
              emoji={emoji}
              key={emoji}
              label={chosen ? `${name} ${t('reactionChosen', '— ваша реакция')}` : name}
              onPick={() => actions.runMessageAction(() => actions.handleReact(message, emoji))}
            />
          );
        })}
      </div>

      {buttons
        .filter((b) => b.show)
        .map((b) => (
          <ContextMenu.Item
            icon={<Icon className="fill-transparent" name={b.icon} />}
            key={b.key}
            onClick={() => actions.runMessageAction(b.action)}
            variant={b.className?.includes('danger') ? 'danger' : 'default'}
          >
            {t(b.key, b.def)}
          </ContextMenu.Item>
        ))}

      <ContextMenu.Item
        icon={<Icon className="fill-transparent" name="checkCircle" />}
        onClick={() =>
          actions.runMessageAction(() =>
            selectionMode ? onSelection(message) : actions.startSelection(message)
          )
        }
      >
        {isSelected ? t('uncheckMessage', 'Снять выбор') : t('checkMessage', 'Выбрать')}
      </ContextMenu.Item>
    </ContextMenu>
  );
};
