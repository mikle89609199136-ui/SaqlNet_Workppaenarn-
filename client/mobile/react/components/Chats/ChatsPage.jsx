import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { services } from '../../../application/services/serviceContainer.js';
import { useRealtimeSocket } from '../../hooks/useRealtimeSocket.js';
import { Identicon } from '../common/Identicon.jsx';

export function ChatsPage({ t = fallbackTranslate }) {
  const [chats, setChats] = useState([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const currentUser = useMemo(() => getCurrentUser(), []);
  const { eventBus } = useRealtimeSocket(true);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    services.chatService.getChats()
      .then((items) => Promise.all(items.map((chat) => decryptChatPreview(chat))))
      .then((items) => {
        if (!isMounted) return;
        setChats(items);
        setError('');
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || t('chatsLoadError', 'Не удалось загрузить чаты'));
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [t]);

  useEffect(() => {
    const updatePreview = async (payload) => {
      const incomingMessage = payload?.message ?? payload;
      const chatId = payload?.chatId ?? incomingMessage?.chatId;
      if (!chatId || !incomingMessage) return;

      const previewChat = await decryptChatPreview({
        id: chatId,
        lastMessage: {
          ...incomingMessage,
          chatId,
        },
      });

      setChats((items) => {
        const index = items.findIndex((chat) => chat.id === chatId);
        if (index === -1) return items;

        const nextChat = {
          ...items[index],
          lastMessage: previewChat.lastMessage,
          lastMessageAt: incomingMessage.createdAt || incomingMessage.timestamp || new Date().toISOString(),
        };
        const nextItems = [nextChat, ...items.slice(0, index), ...items.slice(index + 1)];
        return nextItems;
      });
    };

    const unsubscribeNew = eventBus.on('new_message', updatePreview);
    const unsubscribeSent = eventBus.on('message:sent', updatePreview);
    const unsubscribeRead = eventBus.on('messages:read', ({ chatId }) => {
      setChats((items) => items.map((chat) => (
        chat.id === chatId ? { ...chat, unreadCount: 0 } : chat
      )));
    });

    return () => {
      unsubscribeNew();
      unsubscribeSent();
      unsubscribeRead();
    };
  }, [eventBus]);

  return (
    <main className="chats-page">
      <header className="chats-header">
        <h1>{t('chats', 'Чаты')}</h1>
        <Link className="chats-icon-button" to="/create-group" title={t('createGroup', 'Создать группу')}>
          +
        </Link>
      </header>

      <section className="chats-toolbar">
        <Link className="chats-search" to="/contacts" aria-label={t('search', 'Поиск чатов и людей...')}>
          <span className="chats-search-icon" aria-hidden="true">🔎</span>
          <span className="chats-search-placeholder">{t('search', 'Поиск чатов и людей...')}</span>
        </Link>
      </section>

      <section className="chats-list" aria-busy={isLoading}>
        {isLoading ? <ChatsSkeleton /> : null}
        {!isLoading && error ? <ErrorState message={error} onRetry={() => window.location.reload()} t={t} /> : null}
        {!isLoading && !error && chats.length === 0 ? <EmptyState t={t} /> : null}
        {!isLoading && !error && chats.map((chat) => (
          <ChatListItem chat={chat} key={chat.id} t={t} />
        ))}
      </section>
    </main>
  );
}

function ChatListItem({ chat, t }) {
  const href = `/chats/${encodeURIComponent(chat.id)}`;
  const title = chat.name || t('untitledChat', 'Без названия');
  const lastMessage = getLastMessageText(chat, t);

  const peerId = chat.peerId ?? chat.peer_id ?? null;

  return (
    <Link className="chat-row" to={href}>
      <div className={`chat-avatar chat-avatar-${chat.type || 'private'}`} style={peerId ? { background: 'none', padding: 0 } : {}}>
        {peerId
          ? <Identicon userId={peerId} size={48} />
          : title.slice(0, 1).toUpperCase()
        }
      </div>
      <div className="chat-main">
        <div className="chat-topline">
          <span className="chat-title">{title}</span>
          <span className="chat-time">{formatChatTime(chat.lastMessage?.createdAt || chat.lastMessageAt || chat.createdAt)}</span>
        </div>
        <div className="chat-subline">
          <span>{lastMessage}</span>
          {chat.unreadCount > 0 ? <strong className="chat-unread">{chat.unreadCount}</strong> : null}
        </div>
      </div>
    </Link>
  );
}

function ChatsSkeleton() {
  return Array.from({ length: 6 }, (_item, index) => (
    <div className="chat-row chat-row-skeleton" key={index}>
      <div className="chat-avatar" />
      <div className="chat-main">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-subtitle" />
      </div>
    </div>
  ));
}

function EmptyState({ t }) {
  return (
    <div className="chats-state">
      <div className="chats-state-icon">✉</div>
      <h2>{t('noChatsYet', 'Чатов пока нет')}</h2>
      <p>{t('noChatsYetDescription', 'Создайте группу или найдите контакт, чтобы начать переписку.')}</p>
    </div>
  );
}

function ErrorState({ message, onRetry, t }) {
  return (
    <div className="chats-state">
      <div className="chats-state-icon">!</div>
      <h2>{t('loadingError', 'Ошибка загрузки')}</h2>
      <p>{message}</p>
      <button className="chats-retry" onClick={onRetry} type="button">{t('retry', 'Повторить')}</button>
    </div>
  );
}

async function decryptChatPreview(chat) {
  if (!chat?.id || !chat.lastMessage || typeof chat.lastMessage === 'string') {
    return chat;
  }

  try {
    const message = await services.messageService.processMessageForDisplay(chat.id, {
      ...chat.lastMessage,
      chatId: chat.lastMessage.chatId ?? chat.id,
    });
    return {
      ...chat,
      lastMessage: {
        ...chat.lastMessage,
        content: message.content,
      },
    };
  } catch (error) {
    console.warn('Failed to decrypt chat preview', error);
    return chat;
  }
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('craneapp_user_data') || 'null');
  } catch (_error) {
    return null;
  }
}

function getInitials(user) {
  const source = user?.firstName || user?.username || 'C';
  return source.slice(0, 1).toUpperCase();
}

function getLastMessageText(chat, t) {
  if (typeof chat.lastMessage === 'string') return chat.lastMessage || t('noMessages', 'Нет сообщений');
  if (chat.lastMessage?.content) return chat.lastMessage.content;
  if (chat.lastMessageEncrypted) return t('encryptedMessage', 'Зашифрованное сообщение');
  return t('noMessages', 'Нет сообщений');
}

function formatChatTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function fallbackTranslate(_key, fallback) {
  return fallback;
}
