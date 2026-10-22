import { ROUTES } from '@/shared/config';
import { cn, formatChatListTime, receiptState, useLongPress } from '@/shared/lib';
import type { TReceiptState } from '@/shared/lib';
import { readDraftRich, subscribeToDraft } from '../../model/chatDraftsStore';
import { useTypingLabel } from '../../model/typingLabel';
import { getLastMessageText } from '../../model/getLastMessageText';
import { getChatTitle, isSavedMessages } from '../../model/chatTitle';
import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useMatch } from 'react-router-dom';
import { Avatar, Badge, MessageSnippet } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { useContextMenu } from '@/shared/ui/ContextMenu';
import { chatRowStyles, onCurrentRow } from './chatRowStyles';
import type { IChatDto } from '../../model/types';
import type { RefObject } from 'react';

export interface IChatListItemMenuProps {
  chat: IChatDto;
  pinnedCount: number;
  x: number;
  y: number;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

interface Props {
  chat: IChatDto;
  /** Сколько чатов уже закреплено: больше пяти держать не даём. */
  pinnedCount?: number;
  /**
   * Кто смотрит список: своё последнее сообщение подписывается «Вы:» и
   * несёт галочки. Приходит сверху — сущность чата о профиле не знает.
   */
  currentUserId?: string;
  renderMenu?: (props: IChatListItemMenuProps) => React.ReactNode;
}

export function ChatListItem({ chat, pinnedCount = 0, currentUserId, renderMenu }: Props) {
  const { t, i18n } = useTranslation();
  const title = getChatTitle(chat, t);
  const saved = isSavedMessages(chat);
  const typingLabel = useTypingLabel(chat);
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
    useCallback(() => readDraftRich(chat.id), [chat.id])
  );

  const lastMessage = typingLabel ?? getLastMessageText(chat.lastMessage, t, currentUserId);

  const peerId = chat.peerId;
  const isPeerOnline = Boolean(chat.type === 'private' && (chat.peerIsOnline || typingLabel));

  /* Кто написал последнее: своё — «Вы:», в группе — имя автора. В личном
     чате чужое без подписи: собеседник там один. */
  const last = chat.lastMessage;
  // У звонка направление уже в подписи («Исходящий…»), а «прочитано» у него
  // смысла не имеет: ни «Вы:», ни галочек (#1073). В «Избранном» всё своё,
  // и читать его некому (#1075).
  const isOwnLast = Boolean(
    last && currentUserId && last.senderId === currentUserId && last.type !== 'call' && !saved
  );
  const prefix =
    !typingLabel && last
      ? isOwnLast
        ? `${t('chatList.you', 'Вы')}: `
        : chat.type === 'group' && last.senderName
          ? `${last.senderName}: `
          : ''
      : '';
  /* Галочки своего последнего (#657): в личном чате — отправлено,
     доставлено или прочитано; в группе, как и в ленте, — «отправлено». */
  const status: TReceiptState | undefined =
    isOwnLast && last ? (chat.type === 'private' ? receiptState(last) : 'sent') : undefined;
  const statusLabel = {
    sent: t('messageStatus.sent', 'Отправлено'),
    delivered: t('messageStatus.delivered', 'Доставлено'),
    read: t('messageStatus.read', 'Прочитано'),
  };

  /* Открытый чат прочитан — счётчик на нём не нужен, а на заливке он и
     не виден. Булавка — только у закреплённого без непрочитанных: иначе
     её место занимает счётчик. */
  const isCurrent = Boolean(useMatch(ROUTES.CHAT_BY_ID(chat.id)));
  const hasUnread = (chat.unreadCount > 0 || Boolean(chat.isMarkedUnread)) && !isCurrent;
  const showPin = chat.isPinned && !hasUnread;

  /* Имя ссылки собирается из её содержимого, а не задаётся
     `aria-label`: тот заменяет собой всё внутри, и диктор объявлял одно
     название чата — ни последнего сообщения, ни времени, ни счётчика
     непрочитанных.

     `NavLink` вместо `Link` ради `aria-current="page"`: по нему открытый
     чат и подсвечивается, и объявляется диктором. */
  return (
    <>
      <NavLink
        aria-haspopup="menu"
        className={chatRowStyles}
        data-menu={contextMenu?.open ? 'open' : undefined}
        onContextMenu={handleContextMenu}
        to={ROUTES.CHAT_BY_ID(chat.id)}
        {...longPress}
      >
        <Avatar
          className="size-(--chat-row-avatar)"
          icon={saved ? 'bookmark' : undefined}
          id={peerId}
          name={title}
          online={isPeerOnline}
          size="lg"
          src={chat.avatarUrl}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-0.75">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-body font-semibold text-ink',
                onCurrentRow
              )}
            >
              {title}
            </span>
            {chat.isMuted && (
              <span
                aria-label={t('chatList.muted', 'Без звука')}
                className={cn('flex self-center text-ink-3', onCurrentRow)}
                role="img"
              >
                <Icon className="size-3.5" name="bellOff" />
              </span>
            )}
            <span
              className={cn(
                'flex shrink-0 items-center gap-0.75 text-meta text-ink-3',
                onCurrentRow
              )}
            >
              {status && (
                <span
                  aria-label={statusLabel[status]}
                  className={cn(
                    'flex',
                    /* На открытом чате строка залита акцентом — там цвета
                       те же, что у галочек своего пузыря (#657). */
                    status === 'read'
                      ? 'text-brand group-aria-[current=page]:text-out-read'
                      : 'text-ink-3 group-aria-[current=page]:text-out-tick'
                  )}
                  data-receipt={status}
                  role="img"
                >
                  <Icon
                    className="size-4 stroke-2"
                    name={status === 'sent' ? 'check' : 'checkCheck'}
                  />
                </span>
              )}
              {chat.lastMessageAt && (
                <time
                  className="tabular-nums"
                  dateTime={new Date(chat.lastMessageAt).toISOString()}
                >
                  {formatChatListTime(chat.lastMessageAt, i18n.language)}
                </time>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Недописанное важнее последнего сообщения: человек к нему вернётся. */}
            <span className={cn('min-w-0 flex-1 truncate text-ui text-ink-2', onCurrentRow)}>
              {draft?.text && !typingLabel ? (
                <>
                  <span className={cn('text-danger', onCurrentRow)}>
                    {t('draft', 'Черновик')}:{' '}
                  </span>
                  {draft.entities?.length ? (
                    <MessageSnippet entities={draft.entities} text={draft.text} />
                  ) : (
                    draft.text.replace(/[\r\n]/g, ' ')
                  )}
                </>
              ) : typingLabel ? (
                // Кто печатает — цветом акцента, как живое событие (#837).
                <span className={cn('text-brand', onCurrentRow)}>{typingLabel}</span>
              ) : (
                <>
                  {prefix}
                  {last?.content && last.entities?.length && !last.undecryptable ? (
                    <MessageSnippet entities={last.entities} text={last.content} />
                  ) : (
                    lastMessage
                  )}
                </>
              )}
            </span>
            {hasUnread && (
              <Badge
                label={
                  chat.isMarkedUnread && chat.unreadCount === 0
                    ? t('chatList.markedUnread', 'Отмечен непрочитанным')
                    : `${chat.unreadCount} ${t('unreadMessages', 'непрочитанных')}`
                }
                tone={chat.isMuted ? 'quiet' : 'brand'}
              >
                {chat.isMarkedUnread ? undefined : chat.unreadCount}
              </Badge>
            )}
            {showPin && (
              <span
                aria-label={t('pinnedChat', 'Закреплён')}
                className={cn('flex shrink-0 text-ink-3', onCurrentRow)}
                role="img"
              >
                <Icon className="size-3.75 stroke-2" name="pin" />
              </span>
            )}
          </div>
        </div>
      </NavLink>

      {/* Меню рисуется рядом со строкой, а не внутри неё. Портал уносит
        узел в конец документа, но события React всплывают по дереву
        компонентов, а не по DOM: пункт меню, лежащий внутри ссылки,
        открывал чат при каждом нажатии. */}
      {contextMenu?.open &&
        renderMenu?.({
          chat,
          onClose: closeContextMenu,
          pinnedCount,
          returnFocusRef: openerRef,
          x: contextMenu.x,
          y: contextMenu.y,
        })}
    </>
  );
}
