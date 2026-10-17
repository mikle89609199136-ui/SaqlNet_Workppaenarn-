import { ContextMenu } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { getChatTitle, isSavedMessages } from '@/entities/chat';
import { useChatActions } from '../model/useChatActions';
import type { IChatDto } from '@/types';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

export interface IChatRowMenuProps {
  chat: IChatDto;
  /** Сколько чатов уже закреплено — от этого зависит, можно ли ещё один. */
  pinnedCount: number;
  x: number;
  y: number;
  /** Строка, из которой меню вызвали: ей вернётся фокус при закрытии. */
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /**
   * Блокировка собеседника по личному чату (#727). Приходит сверху: срез
   * блокировок — отдельная фича, и меню о ней не знает.
   */
  block?: IChatRowBlockAction;
  /**
   * Выход из группы (#90). Тоже приходит сверху: подтверждение и передача
   * прав — забота фичи управления группой.
   */
  onLeave?: () => void;
  /*
   * Пункты со скрытым входом (#825): показываются, только когда передан
   * обработчик, — то есть когда появится сама функция.
   */
  /** «Отметить как непрочитанное» (#836). */
  onMarkUnread?: () => void;
  /** «Отключить уведомления» / «Включить уведомления» (#559). */
  mute?: IChatRowMuteAction;
  /** «Удалить чат» — открывает подтверждение с «Удалить и у собеседника» (#838). */
  onDelete?: () => void;
  /** Спрятать меню, не закрывая: пока открыто подтверждение блокировки или выхода. */
  hidden?: boolean;
}

export interface IChatRowBlockAction {
  blocked: boolean;
  onBlock: () => void;
  onUnblock: () => void;
}

export interface IChatRowMuteAction {
  muted: boolean;
  onToggle: () => void;
}

/**
 * Что можно сделать со строкой чата, не открывая его, — по макету (#825).
 *
 * Вызывается правой кнопкой на настольном и долгим нажатием на телефоне, у
 * точки вызова. Сверху — состояние строки (закрепление, прочитанность,
 * уведомления, архив), после разделителя — то, что уводит из чата, красным.
 */
export function ChatRowMenu({
  chat,
  pinnedCount,
  x,
  y,
  returnFocusRef,
  onClose,
  block,
  onLeave,
  onMarkUnread,
  mute,
  onDelete,
  hidden = false,
}: IChatRowMenuProps) {
  const { t } = useTranslation();
  const { togglePin, toggleArchive, markRead, toggleNotificationPreview, isNotificationPending } =
    useChatActions();
  const previewHidden = Boolean(chat.hideNotificationPreview);

  /** Действие и закрытие меню — одним нажатием. */
  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  const hasLeaving = Boolean(block || onLeave || onDelete);

  return (
    <ContextMenu
      aria-label={t('chatActionsFor', 'Действия: {{title}}', { title: getChatTitle(chat, t) })}
      onClose={onClose}
      open={!hidden}
      returnFocusRef={returnFocusRef}
      x={x}
      y={y}
    >
      {/* В архиве не закрепляют: закреплённые — вверху основного списка. */}
      {!chat.isArchived && (
        <ContextMenu.Item
          icon={<Icon name={chat.isPinned ? 'pinOff' : 'pin'} />}
          onClick={run(() => togglePin(chat, pinnedCount))}
        >
          {chat.isPinned ? t('unpinChat', 'Открепить') : t('pinChat', 'Закрепить')}
        </ContextMenu.Item>
      )}

      {chat.unreadCount > 0 ? (
        <ContextMenu.Item icon={<Icon name="checkCheck" />} onClick={run(() => markRead(chat))}>
          {t('markRead', 'Отметить как прочитанное')}
        </ContextMenu.Item>
      ) : (
        onMarkUnread && (
          <ContextMenu.Item icon={<Icon name="inbox" />} onClick={run(onMarkUnread)}>
            {t('markUnread', 'Отметить как непрочитанное')}
          </ContextMenu.Item>
        )
      )}

      {/* Уведомлений у «Избранного» нет — и прятать в них нечего (#1075). */}
      {!isSavedMessages(chat) && (
        <ContextMenu.Item
          icon={<Icon name={previewHidden ? 'eye' : 'eyeOff'} />}
          disabled={isNotificationPending}
          onClick={run(() => toggleNotificationPreview(chat))}
        >
          {previewHidden
            ? t('showNotificationPreview', 'Показывать текст в уведомлениях')
            : t('hideNotificationPreview', 'Скрывать текст в уведомлениях')}
        </ContextMenu.Item>
      )}

      {mute && (
        <ContextMenu.Item
          icon={<Icon name={mute.muted ? 'bell' : 'bellOff'} />}
          onClick={run(mute.onToggle)}
        >
          {mute.muted
            ? t('unmuteChat', 'Включить уведомления')
            : t('muteChat', 'Отключить уведомления')}
        </ContextMenu.Item>
      )}

      <ContextMenu.Item
        icon={<Icon name={chat.isArchived ? 'archiveRestore' : 'archive'} />}
        onClick={run(() => toggleArchive(chat))}
      >
        {chat.isArchived
          ? t('unarchiveChat', 'Вернуть из архива')
          : t('archiveChat', 'Архивировать')}
      </ContextMenu.Item>

      {hasLeaving && <ContextMenu.Separator />}

      {block &&
        (block.blocked ? (
          <ContextMenu.Item icon={<Icon name="user" />} onClick={run(block.onUnblock)}>
            {t('unblock', 'Разблокировать')}
          </ContextMenu.Item>
        ) : (
          /* Меню не закрывается: сверху откроется подтверждение, и
             закроет всё уже оно. */
          <ContextMenu.Item icon={<Icon name="cross" />} onClick={block.onBlock} variant="danger">
            {t('block', 'Заблокировать')}
          </ContextMenu.Item>
        ))}

      {/* Опасное — последним. Меню не закрывается: сверху откроется
          подтверждение. */}
      {onDelete && (
        <ContextMenu.Item icon={<Icon name="trash" />} onClick={onDelete} variant="danger">
          {t('deleteChat.action', 'Удалить чат')}
        </ContextMenu.Item>
      )}
      {onLeave && (
        <ContextMenu.Item icon={<Icon name="logOut" />} onClick={onLeave} variant="danger">
          {t('leaveGroupAction', 'Покинуть группу')}
        </ContextMenu.Item>
      )}
    </ContextMenu>
  );
}
