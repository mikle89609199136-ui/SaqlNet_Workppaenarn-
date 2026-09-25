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
}: IChatRowMenuProps) {
  const { t } = useTranslation();
  const { togglePin, toggleArchive, markRead } = useChatActions();

  return (
    <ContextMenu
      aria-label={t('chatActions', 'Действия с чатом')}
      onClose={onClose}
      open
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
    </ContextMenu>
  );
}
