import type { IRichTextInputHandle } from '@/shared/ui';
import { ContextMenu, Icon, NotoEmoji } from '@/shared/ui';
import { QUICK_REACTIONS } from '@/shared/config';
import { cn, formatReceipt } from '@/shared/lib';
import { useMessageActions } from '../model/useMessageActions';
import {
  availableMessageActions,
  canForwardMessage,
  type TMessageActionPlace,
} from '../model/messageActionRules';
import { canCopyImageToClipboard } from '../model/mediaActions';
import { saveFilePicker } from '@/entities/media';
import { formatEditedAt, pinsQuery } from '@/entities/message';
import { useProfileStore } from '@/entities/user';
import { chatQuery, useChatUiStore } from '@/entities/chat';
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
      // при обходе с клавиатуры, как `:focus-visible` в макете. Выключать
      // по фокусу нельзя: мышь фокусирует кнопку при нажатии, и анимация,
      // пропав между нажатием и отпусканием, съедала бы сам клик.
      onFocus={(event) => {
        if (focusVisible(event.currentTarget)) setActive(true);
      }}
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
  /**
   * Первой строкой — когда своё сообщение доставлено или прочитано (#657).
   * Только в личном чате: в группе у этого нет одного значения.
   */
  showReceipt?: boolean;
  /**
   * Где открыто меню. В списке закреплённых нет поля ввода и диалога
   * удаления — «Ответить», «Изменить», «Выбрать» и «Удалить» там не
   * показываются (#655).
   */
  place?: TMessageActionPlace;
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
  showReceipt = false,
  place = 'thread',
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
  const setReactionAuthorsModal = useChatUiStore((state) => state.setReactionAuthorsModal);
  // Закреплённые живут в кеше запросов: меню должно знать, закреплено ли
  // сообщение, чтобы показать «Закрепить» или «Открепить».
  const { data: pinnedMessages = [] } = useQuery(pinsQuery(chatId));
  const { data: personalPins = [] } = useQuery(pinsQuery(chatId, 'personal'));
  const { data: chat } = useQuery(chatQuery(chatId));
  const canShare = chat?.type === 'private' || chat?.role === 'owner' || chat?.role === 'admin';

  const messageRef = useMemo(
    () => ({
      get current() {
        return document.getElementById(message.id);
      },
    }),
    [message.id]
  );

  const mine = message.senderId === currentUser?.id;
  const myReaction = message.reactions?.find((reaction) => reaction.myReaction)?.emoji;
  const isChatPinned =
    pinnedMessages.some((p) => p.messageId === message.id) ||
    Boolean(message.isChatPinned ?? message.isPinned);
  const isPersonalPinned =
    personalPins.some((p) => p.messageId === message.id) || Boolean(message.isPersonalPinned);
  const isPinned = isChatPinned || isPersonalPinned;
  const pinTarget = useMemo(
    () => ({ ...message, isChatPinned, isPersonalPinned }),
    [message, isChatPinned, isPersonalPinned]
  );
  const isSelected = selectedMessages.some((m) => m.id === message.id);
  const receipt = mine && showReceipt ? formatReceipt(message, t) : null;
  // Время правки — у своих и у чужих (#1066): на телефоне наведения нет,
  // и подсказка у «изменено» там не видна.
  const editedAt = formatEditedAt(message, t);
  // Что вообще можно сделать с этим сообщением (#655): недоступное
  // скрывается, а не отключается.
  const available = useMemo(
    () =>
      availableMessageActions(message, {
        mine,
        place,
        isPinned,
        canCopyImage: canCopyImageToClipboard(),
      }),
    [message, mine, place, isPinned]
  );
  // Фото копируется картинкой (с подписью текстом) — одним пунктом
  // «Копировать», как и текст.
  const copiesImage = available.has('copyImage') && !selectionMode;
  // Окно «Сохранить как» есть не везде: где его нет, пункт честно
  // называется «Скачать».
  const canPickLocation = saveFilePicker() !== null;
  // В режиме выделения пересылаются все отмеченные: одно непересылаемое
  // среди них сорвало бы всю пачку (#1061).
  const forwardsSelection = !selectionMode || selectedMessages.every(canForwardMessage);

  // Список пересобирается только когда меняется то, от чего он зависит:
  // само сообщение, режим выделения и признак закрепления. Иначе десяток
  // объектов с переведёнными подписями создавался бы на каждый рендер.
  const buttons: IActionButton[] = useMemo(
    () => [
      {
        show: available.has('reply') && !selectionMode,
        icon: 'reply',
        key: 'reply',
        def: t('messageActions.reply', 'Ответить'),
        action: () => actions.startReply(message),
      },
      {
        show: available.has('viewReactions') && !selectionMode,
        icon: 'heart',
        key: 'viewReactions',
        def: t('messageActions.whoReacted', 'Кто отреагировал'),
        action: () =>
          setReactionAuthorsModal({
            messageId: message.id,
            chatId: message.chatId,
            reactions: message.reactions,
          }),
      },
      {
        // В режиме выбора копируются все отмеченные — пункт есть всегда.
        show: available.has('copyText') || copiesImage || selectionMode,
        icon: 'copy',
        key: 'copy',
        def: t('messageActions.copy', 'Копировать'),
        action: () =>
          copiesImage ? actions.handleCopyImage(message) : actions.handleCopyMessage(message),
      },
      {
        show: available.has('save') && !selectionMode,
        icon: 'download',
        key: 'save',
        def: canPickLocation
          ? t('messageActions.saveAs', 'Сохранить как…')
          : t('messageActions.download', 'Скачать'),
        action: () => actions.handleSaveMedia(message),
      },
      {
        show: available.has('translate') && !selectionMode,
        icon: 'language',
        key: 'translate',
        def: t('action.translate', 'Перевести'),
        action: () => actions.handleTranslateMessage(message),
      },
      {
        show: available.has('edit') && !selectionMode,
        icon: 'edit',
        key: 'edit',
        def: t('messageActions.edit', 'Изменить'),
        action: () => actions.startEdit(message),
      },
      // Закрепление и открепление отличаются только подписью: в режиме
      // выделения действие применяется ко всем отмеченным, поэтому
      // «Закрепить всё».
      {
        show:
          available.has('pin') ||
          (available.has('unpin') && (!isPersonalPinned || (!isChatPinned && canShare))),
        icon: 'pin',
        key: 'pin',
        def: selectionMode
          ? t('messageActions.pinAll', 'Закрепить всё')
          : t('messageActions.pin', 'Закрепить'),
        action: () => actions.handlePinMessage(pinTarget),
      },
      {
        show: available.has('unpin') && (isPersonalPinned || canShare),
        icon: 'pin',
        key: 'unpin',
        def: selectionMode
          ? t('messageActions.unpinAll', 'Открепить всё')
          : t('messageActions.unpin', 'Открепить'),
        action: () => actions.handleUnpinMessage(pinTarget),
      },
      {
        show: available.has('forward') && forwardsSelection,
        icon: 'forward',
        key: 'forward',
        def: t('messageActions.forward', 'Переслать'),
        action: () => actions.handleForward(message),
      },
      // «Выбрать» — перед удалением: опасное действие по макету последнее.
      {
        show: available.has('select'),
        icon: 'checkCircle',
        key: 'select',
        def: isSelected ? t('uncheckMessage', 'Снять выбор') : t('checkMessage', 'Выбрать'),
        action: () => (selectionMode ? onSelection(message) : actions.startSelection(message)),
      },
      // Удалить можно и чужое — у себя (#840); у кого, решает диалог.
      {
        show: available.has('delete'),
        icon: 'trash',
        key: 'delete',
        def: t('messageActions.delete', 'Удалить'),
        action: () => actions.handleDelete(message),
        className: 'is-danger',
      },
    ],
    [
      actions,
      available,
      canPickLocation,
      canShare,
      isChatPinned,
      isPersonalPinned,
      pinTarget,
      copiesImage,
      forwardsSelection,
      isSelected,
      message,
      onSelection,
      selectionMode,
      setReactionAuthorsModal,
      t,
    ]
  );

  return (
    <ContextMenu
      aria-label={t('messageActions.title', 'Действия с сообщением')}
      className="w-61 min-w-0"
      onClose={() => setActionMenu(null)}
      open
      returnFocusRef={messageRef}
      x={actionMenu?.x}
      y={actionMenu?.y}
    >
      {/* Две строки — «Прочитано…», затем «Изменено…» — под одной чертой. */}
      {receipt && (
        <div
          aria-label={receipt}
          className={cn(
            'flex items-center gap-1.5 px-2 pt-1 text-meta text-ink-3',
            editedAt ? 'pb-1' : 'mb-1 border-b border-divider pb-1.75'
          )}
          role="group"
        >
          <Icon aria-hidden="true" className="size-4 shrink-0 stroke-2" name="checkCheck" />
          <span aria-hidden="true">{receipt}</span>
        </div>
      )}
      {editedAt && (
        <div
          aria-label={editedAt}
          className={cn(
            'mb-1 flex items-center gap-1.5 border-b border-divider px-2 pb-1.75 text-meta text-ink-3',
            !receipt && 'pt-1'
          )}
          role="group"
        >
          <Icon aria-hidden="true" className="size-4 shrink-0 stroke-2" name="edit" />
          <span aria-hidden="true">{editedAt}</span>
        </div>
      )}

      {/* Реакции идут рядом, а не столбиком: их шесть, они короткие, и
          выбирают из них глазами, а не по названию. Роль у каждой та же,
          что у обычного пункта, — иначе стрелки перескакивали бы через
          весь ряд. Неотправленному реакцию не поставить — ряда нет. */}
      {available.has('react') && (
        <div
          aria-label={t('messageActions.reactions', 'Реакции')}
          className="mb-1 flex justify-between border-b border-divider px-0.5 pt-0.5 pb-1.75"
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
      )}

      {buttons
        .filter((b) => b.show)
        .map((b) => (
          <ContextMenu.Item
            icon={<Icon className="fill-transparent" name={b.icon} />}
            key={b.key}
            onClick={() => actions.runMessageAction(b.action)}
            variant={b.className?.includes('danger') ? 'danger' : 'default'}
          >
            {/* Подпись уже переведена: по короткому ключу (`edit`, `copy`)
                подставлялись чужие строки — «Редактировать» вместо «Изменить». */}
            {b.def}
          </ContextMenu.Item>
        ))}
    </ContextMenu>
  );
};
