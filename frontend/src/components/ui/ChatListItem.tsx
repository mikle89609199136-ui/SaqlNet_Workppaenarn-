import { readDraft, subscribeToDraft } from '@/store/chatDrafts';
import { useTypingStore } from '@/store/typing';
import { ROUTES } from '@/consts';
import { getLastMessageText } from '@/utils';
import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Avatar } from './Avatar';
import type { IChatDto } from '@/types';

interface Props {
  chat: IChatDto;
}

export function ChatListItem({ chat }: Props) {
  const { t } = useTranslation();
  const title = chat.title || t('untitledChat', 'Без названия');
  const typingUserId = useTypingStore((state) => state.typingByChat[chat.id] ?? null);

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

  return (
    <Link className="chat-row" to={ROUTES.CHAT_BY_ID(chat.id)} aria-label={title}>
      <Avatar id={peerId} name={title} online={isPeerOnline} size="lg" src={chat.avatarUrl} />
      <div className="chat-main">
        <div className="chat-topline">
          <span className="chat-title">{title}</span>
          <span className="chat-time">
            {chat.lastMessageAt && formatChatTime(chat.lastMessageAt)}
          </span>
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
          {chat.unreadCount > 0 && <strong className="chat-unread">{chat.unreadCount}</strong>}
        </div>
      </div>
    </Link>
  );
}

function formatChatTime(value: Date | string): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
