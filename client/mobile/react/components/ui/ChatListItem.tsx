import { ROUTES } from '@/consts';
import { cn, getLastMessageText } from '@/utils';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Identicon } from '@/components/ui';
import type { IChatDto } from '@/types';

interface Props {
  chat: IChatDto;
}

export function ChatListItem({ chat }: Props) {
  const { t } = useTranslation();
  const title = chat.title || t('untitledChat', 'Без названия');
  const lastMessage = chat.typingUserId ? t('typing', 'печатает...') : getLastMessageText(chat.lastMessage, t);

  const peerId = chat.peerId;
  const isPeerOnline = Boolean(chat.type === 'private' && (chat.peerIsOnline || chat.typingUserId));

  return (
    <Link className="chat-row" to={ROUTES.CHAT_BY_ID(chat.id)} aria-label={title}>
      <div
        className={cn(
          'chat-avatar',
          `chat-avatar-${chat.type || 'private'}`,
          isPeerOnline && 'is-online'
        )}
        style={peerId ? { background: 'none', padding: 0 } : {}}
      >
        {peerId ? <Identicon userId={peerId} size={48} /> : title.slice(0, 1).toUpperCase()}
      </div>
      <div className="chat-main">
        <div className="chat-topline">
          <span className="chat-title">{title}</span>
          <span className="chat-time">
            {chat.lastMessageAt && formatChatTime(chat.lastMessageAt)}
          </span>
        </div>
        <div className="chat-subline">
          <span>{lastMessage}</span>
          {chat.unreadCount > 0 && (
            <strong className="chat-unread">{chat.unreadCount}</strong>
          )}
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