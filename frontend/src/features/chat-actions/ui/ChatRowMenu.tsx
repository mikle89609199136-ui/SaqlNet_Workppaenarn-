import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import {
  useBlockedUsers,
  useBlockUserMutation,
  useUnblockUserMutation,
  BlockUserConfirmDialog,
} from '@/features/blocked-users';
import type { IChatDto } from '@/entities/chat';
import { useChatActions } from '../model/useChatActions';

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
  const { isUserBlocked } = useBlockedUsers();
  const blockMutation = useBlockUserMutation();
  const unblockMutation = useUnblockUserMutation();
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  const isPrivate = chat.type === 'private' && Boolean(chat.peerId);
  const isBlocked = Boolean(isPrivate && chat.peerId && isUserBlocked(chat.peerId));

  return (
    <>
      <ContextMenu
        aria-label={t('chatActions', 'Действия с чатом')}
        onClose={onClose}
        open={!showBlockConfirm}
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

        {isPrivate && chat.peerId && (
          isBlocked ? (
            <ContextMenu.Item
              icon={<Icon name="user" />}
              onClick={() => {
                void unblockMutation.mutateAsync(chat.peerId!);
                onClose();
              }}
            >
              {t('settings.privacy.unblock', 'Разблокировать')}
            </ContextMenu.Item>
          ) : (
            <ContextMenu.Item
              className="text-danger focus:bg-danger/10 focus:text-danger"
              icon={<Icon name="cross" />}
              onClick={() => {
                setShowBlockConfirm(true);
              }}
              variant="danger"
            >
              {t('settings.privacy.block', 'Заблокировать')}
            </ContextMenu.Item>
          )
        )}
      </ContextMenu>

      {isPrivate && chat.peerId && (
        <BlockUserConfirmDialog
          confirming={blockMutation.isPending}
          onCancel={onClose}
          onConfirm={async () => {
            try {
              await blockMutation.mutateAsync({
                userId: chat.peerId!,
                user: { username: chat.title },
              });
              onClose();
            } catch {
              // Toast показан мутацией
            }
          }}
          open={showBlockConfirm}
          userName={chat.title}
        />
      )}
    </>
  );
}
