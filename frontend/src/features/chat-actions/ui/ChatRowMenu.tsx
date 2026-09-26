import { ContextMenu } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
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
  /** Спрятать меню, не закрывая: пока открыто подтверждение блокировки или выхода. */
  hidden?: boolean;
}

export interface IChatRowBlockAction {
  blocked: boolean;
  onBlock: () => void;
  onUnblock: () => void;
}

/**
 * Что можно сделать со строкой чата, не открывая его.
 *
 * Вызывается правой кнопкой на настольном и долгим нажатием на телефоне.
 * Набор пунктов пока короткий: закрепление и архив — то, что бэкенд
 * умеет и что менялось молча, без единого способа управлять этим из
 * интерфейса.
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
  hidden = false,
}: IChatRowMenuProps) {
  const { t } = useTranslation();
  const { togglePin, toggleArchive, markRead } = useChatActions();

  return (
    <ContextMenu
      aria-label={t('chatActions', 'Действия с чатом')}
      onClose={onClose}
      open={!hidden}
      returnFocusRef={returnFocusRef}
      x={x}
      y={y}
    >
      {/* Пункт показывается только там, где нажимать есть что: чат без
          непрочитанных — это действие ни о чём. */}
      {chat.unreadCount > 0 && (
        <ContextMenu.Item
          icon={<Icon name="check" />}
          onClick={() => {
            markRead(chat);
            onClose();
          }}
        >
          {t('markRead', 'Прочитано')}
        </ContextMenu.Item>
      )}

      <ContextMenu.Item
        icon={<Icon name="pin" />}
        onClick={() => {
          togglePin(chat, pinnedCount);
          onClose();
        }}
      >
        {chat.isPinned ? t('unpinChat', 'Открепить') : t('pinChat', 'Закрепить')}
      </ContextMenu.Item>

      <ContextMenu.Item
        icon={<Icon name="download" />}
        onClick={() => {
          toggleArchive(chat);
          onClose();
        }}
      >
        {chat.isArchived ? t('unarchiveChat', 'Вернуть из архива') : t('archiveChat', 'В архив')}
      </ContextMenu.Item>

      {block &&
        (block.blocked ? (
          <ContextMenu.Item
            icon={<Icon name="user" />}
            onClick={() => {
              block.onUnblock();
              onClose();
            }}
          >
            {t('unblock', 'Разблокировать')}
          </ContextMenu.Item>
        ) : (
          /* Меню не закрывается: сверху откроется подтверждение, и
             закроет всё уже оно. */
          <ContextMenu.Item icon={<Icon name="cross" />} onClick={block.onBlock} variant="danger">
            {t('block', 'Заблокировать')}
          </ContextMenu.Item>
        ))}

      {/* Меню не закрывается: сверху откроется подтверждение. */}
      {onLeave && (
        <ContextMenu.Item icon={<Icon name="logOut" />} onClick={onLeave} variant="danger">
          {t('leaveGroupAction', 'Покинуть группу')}
        </ContextMenu.Item>
      )}
    </ContextMenu>
  );
}
