import { ROUTES } from '@/shared/config';
import { useLongPress } from '@/shared/lib';
import { readDraft, subscribeToDraft } from '@/store/chatDrafts';
import { useTypingStore } from '../../model/typingStore';
import { formatChatListTime } from '@/shared/lib/chatListTime';
import { getLastMessageText } from '../../model/getLastMessageText';
import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { Avatar, Badge } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useContextMenu } from '@/shared/ui/ContextMenu';
import { ChatRowMenu } from './ChatRowMenu';
import type { IChatDto } from '../../model/types';

interface Props {
  chat: IChatDto;
  /** Сколько чатов уже закреплено: больше пяти держать не даём. */
  pinnedCount?: number;
}

export function ChatListItem({ chat, pinnedCount = 0 }: Props) {
  const { t, i18n } = useTranslation();
  const title = chat.title || t('untitledChat', 'Без названия');
  const typingUserId = useTypingStore((state) => state.typingByChat[chat.id] ?? null);
  const { contextMenu, handleContextMenu, closeContextMenu, openerRef } = useContextMenu();

  /* Долгое нажатие — тот же вызов меню, что правой кнопкой. Хук принимает
     событие мыши, поэтому жест приносит только координаты, а остальное
     здесь подставляется заглушками: гасить в этот момент уже нечего. */
  const openMenuAt = useCallback(
    (x: number, y: number) =>
      handleContextMenu({
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: x,
        clientY: y,
      } as MouseEvent),
    [handleContextMenu]
  );
  const longPress = useLongPress(openMenuAt);

  // Черновик живёт вне React, поэтому читается через подписку. Она
  // срабатывает не на каждый символ, а когда человек перестал печатать:
  // иначе строка мигала бы всё время набора.
  const draft = useSyncExternalStore(
    useCallback((onChange) => subscribeToDraft(chat.id, onChange), [chat.id]),
    useCallback(() => readDraft(chat.id), [chat.id])
  );

  const lastMessage = typingUserId
    ? t('typing', 'печатает...')
    : getLastMessageText(chat.lastMessage, t);

  const peerId = chat.peerId;
  const isPeerOnline = Boolean(chat.type === 'private' && (chat.peerIsOnline || typingUserId));

  /* Имя ссылки собирается из её содержимого, а не задаётся
     `aria-label`: тот заменяет собой всё внутри, и диктор объявлял одно
     название чата — ни последнего сообщения, ни времени, ни счётчика
     непрочитанных.

     `NavLink` вместо `Link` ради `aria-current="page"`: по нему открытый
     чат и подсвечивается, и объявляется диктором. */
  return (
    <>
      <NavLink
        className="chat-row"
        onContextMenu={handleContextMenu}
        to={ROUTES.CHAT_BY_ID(chat.id)}
        {...longPress}
      >
        <Avatar id={peerId} name={title} online={isPeerOnline} size="lg" src={chat.avatarUrl} />
        <div className="chat-main">
          <div className="chat-topline">
            <span className="chat-title">{title}</span>
            {chat.isPinned && (
              <span
                aria-label={t('pinnedChat', 'Закреплён')}
                className="shrink-0 text-ink-3 [&>svg]:size-3.5"
                role="img"
              >
                <Icon name="pin" />
              </span>
            )}
            {chat.lastMessageAt && (
              <time className="chat-time" dateTime={new Date(chat.lastMessageAt).toISOString()}>
                {formatChatListTime(chat.lastMessageAt, i18n.language)}
              </time>
            )}
          </div>
          <div className="chat-subline">
            {/* Недописанное важнее последнего сообщения: человек к нему вернётся. */}
            {draft && !typingUserId ? (
              <span className="chat-draft">
                <span className="chat-draft-label">{t('draft', 'Черновик')}: </span>
                {draft}
              </span>
            ) : (
              <span>{lastMessage}</span>
            )}
            {/* Приглушённый оттенок ждёт своего часа: состояние звука живёт
              на участнике и в списке чатов не приходит вовсе — #387.
              Пока метка всегда акцентная. */}
            {chat.unreadCount > 0 && (
              <Badge label={`${chat.unreadCount} ${t('unreadMessages', 'непрочитанных')}`}>
                {chat.unreadCount}
              </Badge>
            )}
          </div>
        </div>
      </NavLink>

      {/* Меню рисуется рядом со строкой, а не внутри неё. Портал уносит
        узел в конец документа, но события React всплывают по дереву
        компонентов, а не по DOM: пункт меню, лежащий внутри ссылки,
        открывал чат при каждом нажатии. */}
      {contextMenu?.open && (
        <ChatRowMenu
          chat={chat}
          onClose={closeContextMenu}
          pinnedCount={pinnedCount}
          returnFocusRef={openerRef}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}
    </>
  );
}
