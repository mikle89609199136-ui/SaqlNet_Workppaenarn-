import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { services } from '../../../application/services/serviceContainer.js';
import Message from '../../../domain/entities/Message.js';
import { useRealtimeSocket } from '../../hooks/useRealtimeSocket.js';
import { Identicon } from '../common/Identicon.jsx';
import { useCall } from '../Calls/CallProvider.jsx';
import { GroupInfoModal } from './GroupInfoModal.jsx';

export function ChatThreadPage({ chatId, onProfileStateChange, profileCloseToken = 0, profileMode = 'modal', t = fallbackTranslate }) {
  const [chat, setChat] = useState(null);
  const [draft, setDraft] = useState('');
  const [editingMessage, setEditingMessage] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState([]);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [typingUserId, setTypingUserId] = useState(null);
  const [actionMenu, setActionMenu] = useState(null);
  const [profileModal, setProfileModal] = useState({ isOpen: false, isLoading: false, error: '', user: null });
  const currentUser = useMemo(() => getCurrentUser(), []);
  const bottomRef = useRef(null);
  const lastTypingSentAtRef = useRef(0);
  const typingTimeoutRef = useRef(null);
  const { eventBus, socket } = useRealtimeSocket(Boolean(chatId));
  const { initiateCall } = useCall();

  useEffect(() => {
    if (profileMode !== 'panel' || typeof onProfileStateChange !== 'function') return undefined;
    onProfileStateChange({ ...profileModal, chat });
    return undefined;
  }, [chat, onProfileStateChange, profileMode, profileModal]);

  useEffect(() => {
    setProfileModal({ isOpen: false, isLoading: false, error: '', user: null });
  }, [chatId]);

  useEffect(() => {
    if (profileCloseToken === 0) return;
    setProfileModal({ isOpen: false, isLoading: false, error: '', user: null });
  }, [profileCloseToken]);

  useEffect(() => {
    if (!actionMenu) return undefined;

    const closeActionMenu = () => setActionMenu(null);
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeActionMenu();
    };

    window.addEventListener('click', closeActionMenu);
    window.addEventListener('scroll', closeActionMenu, true);
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('click', closeActionMenu);
      window.removeEventListener('scroll', closeActionMenu, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [actionMenu]);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      services.chatService.getChat(chatId),
      services.messageService.getMessages(chatId),
    ])
      .then(([nextChat, nextMessages]) => {
        if (!isMounted) return;
        setChat(nextChat);
        setMessages(nextMessages);
        markMessagesAsRead(chatId, nextMessages);
        setError('');
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || t('chatLoadError', 'Не удалось загрузить чат'));
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [chatId, t]);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages.length]);

  useEffect(() => {
    const unsubscribeNew = eventBus.on('new_message', async (event) => {
      if (event.chatId !== chatId || !event.message) return;
      const nextMessage = typeof services.messageService.processMessageForDisplay === 'function'
        ? await services.messageService.processMessageForDisplay(chatId, event.message)
        : Message.fromAPI(event.message);
      services.messageService.addMessageToCache(chatId, nextMessage);
      setMessages((items) => appendUniqueMessage(items, nextMessage));
      markMessagesAsRead(chatId, [nextMessage]);
    });

    const unsubscribeEdited = eventBus.on('message_edited', (event) => {
      setMessages((items) => items.map((message) => (
        message.id === event.messageId
          ? { ...message, content: event.content, editedAt: event.editedAt, isEdited: true }
          : message
      )));
    });

    const unsubscribeDeleted = eventBus.on('message_deleted', (event) => {
      if (event.chatId && event.chatId !== chatId) return;
      setMessages((items) => items.filter((message) => message.id !== event.messageId));
    });

    const handleTyping = (event) => {
      if (event.chatId !== chatId) return;
      const userId = event.userId || event.senderId || event.from;
      if (!userId || userId === currentUser?.id) return;

      setTypingUserId(userId);
      setChat((currentChat) => currentChat?.type === 'private'
        ? { ...currentChat, peerIsOnline: true }
        : currentChat);
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = window.setTimeout(() => {
        setTypingUserId(null);
      }, 3000);
    };
    const unsubscribeTyping = eventBus.on('typing', handleTyping);
    const unsubscribeUserTyping = eventBus.on('user_typing', handleTyping);

    return () => {
      unsubscribeNew();
      unsubscribeEdited();
      unsubscribeDeleted();
      unsubscribeTyping();
      unsubscribeUserTyping();
      window.clearTimeout(typingTimeoutRef.current);
    };
  }, [chatId, currentUser?.id, eventBus]);

  function markMessagesAsRead(targetChatId, nextMessages) {
    const messageIds = nextMessages
      .filter((message) => message?.id && message.senderId !== currentUser?.id)
      .map((message) => message.id);
    if (messageIds.length === 0 || typeof services.messageService.markAsRead !== 'function') return;
    services.messageService.markAsRead(targetChatId, messageIds).catch((err) => {
      console.warn('Failed to mark messages as read', err);
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending) return;

    setIsSending(true);
    try {
      if (editingMessage) {
        const result = await services.messageService.editMessage(editingMessage.id, content);
        setMessages((items) => updateMessage(items, editingMessage.id, {
          content: result.content,
          editedAt: result.editedAt,
          isEdited: true,
        }));
        setEditingMessage(null);
      } else {
        const message = await services.messageService.sendMessage(chatId, content, 'text', replyToMessage?.id || null);
        setMessages((items) => appendUniqueMessage(items, message));
        setReplyToMessage(null);
      }
      setDraft('');
      setError('');
    } catch (err) {
      setError(err.message || t('messageSendError', 'Не удалось отправить сообщение'));
    } finally {
      setIsSending(false);
    }
  }

  function handleDraftChange(event) {
    setDraft(event.target.value);
    sendTyping();
  }

  function handleComposerKeyDown(event) {
    if (event.key === 'Escape' && (editingMessage || replyToMessage)) {
      event.preventDefault();
      cancelComposerMode();
      return;
    }
    if (event.key !== 'ArrowUp' || draft.trim() || editingMessage || replyToMessage) return;
    const lastOwnMessage = [...messages].reverse().find((message) => (
      message.senderId === currentUser?.id && !message.deletedAt
    ));
    if (!lastOwnMessage) return;

    event.preventDefault();
    startEdit(lastOwnMessage);
  }

  function sendTyping() {
    if (!chatId || !socket?.isConnected) return;

    const now = Date.now();
    if (now - lastTypingSentAtRef.current < 1500) return;
    lastTypingSentAtRef.current = now;

    try {
      socket.send({ type: 'typing', chatId, userId: currentUser?.id });
    } catch (err) {
      console.warn('Failed to send typing event', err);
    }
  }

  async function handleDelete(message) {
    try {
      await services.messageService.deleteMessage(message.id);
      setMessages((items) => items.filter((item) => item.id !== message.id));
      if (editingMessage?.id === message.id) {
        setEditingMessage(null);
        setDraft('');
      }
      if (replyToMessage?.id === message.id) {
        setReplyToMessage(null);
      }
      setError('');
    } catch (err) {
      setError(err.message || t('messageDeleteError', 'Не удалось удалить сообщение'));
    }
  }

  async function handleReact(message, emoji) {
    try {
      const result = await services.messageService.reactToMessage(message.id, emoji);
      setMessages((items) => updateMessage(items, message.id, { reactions: result.reactions || [] }));
      setError('');
    } catch (err) {
      setError(err.message || t('reactionError', 'Не удалось обновить реакцию'));
    }
  }

  function openMessageActions(message, rect) {
    const menuWidth = 232;
    const menuHeight = 150;
    const gap = 12;
    const viewportWidth = window.innerWidth || menuWidth;
    const viewportHeight = window.innerHeight || menuHeight;
    const isMine = message.senderId === currentUser?.id;
    const sideX = isMine ? rect.left - menuWidth - gap : rect.right + gap;
    const fallbackX = isMine ? rect.left : rect.right - menuWidth;
    const preferredX = sideX >= 8 && sideX + menuWidth <= viewportWidth - 8 ? sideX : fallbackX;
    const preferredY = rect.top + rect.height / 2 - menuHeight / 2;
    const x = Math.min(Math.max(preferredX, 8), Math.max(viewportWidth - menuWidth - 8, 8));
    const y = Math.min(Math.max(preferredY, 8), Math.max(viewportHeight - menuHeight - 8, 8));
    setActionMenu({ messageId: message.id, x, y });
  }

  function closeMessageActions() {
    setActionMenu(null);
  }

  function runMessageAction(action) {
    action();
    closeMessageActions();
  }

  function startEdit(message) {
    setEditingMessage(message);
    setReplyToMessage(null);
    setDraft(message.content || '');
  }

  function startReply(message) {
    setReplyToMessage(message);
    setEditingMessage(null);
  }

  function cancelComposerMode() {
    setEditingMessage(null);
    setReplyToMessage(null);
    setDraft('');
  }

  async function openChatProfile() {
    if (chat?.type === 'group') {
      setIsGroupInfoOpen(true);
      return;
    }
    if (chat?.type !== 'private' || !chat.peerId) return;

    setProfileModal({ isOpen: true, isLoading: true, error: '', user: null });
    try {
      const profile = await services.userService.getProfile(chat.peerId);
      setProfileModal({ isOpen: true, isLoading: false, error: '', user: profile });
    } catch (err) {
      setProfileModal({
        isOpen: true,
        isLoading: false,
        error: err.message || t('profileLoadError', 'Не удалось загрузить профиль'),
        user: null,
      });
    }
  }

  const title = chat?.name || chat?.title || t('chat', 'Чат');
  const subtitle = getChatSubtitle(chat, typingUserId, t);
  const isPeerOnline = Boolean(chat?.type === 'private' && chat?.peerIsOnline);
  const peerAvatarUrl = chat?.avatarUrl || '';
  const selectedActionMessage = actionMenu
    ? messages.find((message) => message.id === actionMenu.messageId)
    : null;

  return (
    <main className="thread-page">
      <header className="thread-header">
        <Link className="thread-back" to="/chats" aria-label={t('back', 'Назад')}>‹</Link>
        <button
          aria-label={title}
          className={`thread-avatar ${isPeerOnline ? 'is-online' : ''}`}
          onClick={openChatProfile}
          type="button"
        >
          {peerAvatarUrl ? (
            <img alt="" src={peerAvatarUrl} />
          ) : chat?.type === 'private' && chat?.peerId ? (
            <Identicon userId={chat.peerId} size={44} />
          ) : (
            title.slice(0, 1).toUpperCase()
          )}
        </button>
        <div className="thread-title-wrap" onClick={openChatProfile} style={{ cursor: chat?.type === 'group' || chat?.type === 'private' ? 'pointer' : 'default' }}>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="thread-call-actions">
          <button
            className="thread-call-button"
            onClick={() => initiateCall(chatId, chat?.type, title, 'audio')}
            title={t('audioCall', 'Аудиозвонок')}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="thread-call-icon"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g fill="none">
                <path d="M0 0h24v24H0z" />

                <path
                  fill="currentColor"
                  d="M4.477 4.116c-2.924 3.217-1.362 8.196 2.932 12.51 4.204 4.222 9.407 5.8 12.486 2.936 1.685-1.567 1.436-4.343-.645-6.198l-.19-.161c-1.931-1.563-4.734-1.568-6.445-.027l-.088.082-.05-.042c-.187-.16-.43-.381-.724-.673l-.298-.303-.306-.326q-.138-.152-.246-.277l-.124-.147-.07.075c1.69-1.697 1.706-4.72.006-6.75-1.887-2.255-4.75-2.335-6.238-.699M9.335 5.97c1.18 1.41 1.049 3.371.099 4.325l-.148.14c-.63.567-1.246.901 1.032 3.218 2.458 2.499 2.765 1.622 3.405.952 1.006-1.01 2.975-1.104 4.329.103 1.497 1.334 1.335 2.868.617 3.536-2.222 2.067-6.476.636-9.984-2.888S3.621 7.734 5.81 5.326c.508-.558 2.101-1.057 3.526.644"
                />
              </g>
            </svg>

          </button>
          <button
            className="thread-call-button"
            onClick={() => initiateCall(chatId, chat?.type, title, 'video')}
            title={t('videoCall', 'Видео')}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="thread-call-icon thread-call-icon-video"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g fill="none">
                <path d="M0 0h24v24H0z" />

                <path
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M6.5 5.75A3.5 3.5 0 0 0 3 9.25v5.5a3.5 3.5 0 0 0 3.5 3.5h7a3.5 3.5 0 0 0 3.5-3.5v-.52l2.65 2.07A1.45 1.45 0 0 0 22 15.15v-6.3a1.45 1.45 0 0 0-2.35-1.15L17 9.77v-.52a3.5 3.5 0 0 0-3.5-3.5h-7Zm-1.7 3.5A1.7 1.7 0 0 1 6.5 7.55h7a1.7 1.7 0 0 1 1.7 1.7v5.5a1.7 1.7 0 0 1-1.7 1.7h-7a1.7 1.7 0 0 1-1.7-1.7v-5.5Zm12.2 2.8 3.2 2.5v-5.1L17 11.95v.1Z"
                />
              </g>
            </svg>

          </button>
        </div>
      </header>

      <section className="thread-messages" aria-busy={isLoading}>
        {isLoading ? <ThreadSkeleton /> : null}
        {!isLoading && error && messages.length === 0 ? <ThreadState message={error} title={t('loadingError', 'Ошибка загрузки')} /> : null}
        {!isLoading && !error && messages.length === 0 ? (
          <ThreadState
            message={t('emptyThreadDescription', 'Напишите первое сообщение в этом чате.')}
            title={t('emptyThread', 'Сообщений пока нет')}
          />
        ) : null}
        {messages.map((message) => (
          <MessageBubble
            currentUserId={currentUser?.id}
            isActionTarget={actionMenu?.messageId === message.id}
            key={message.id}
            message={message}
            onOpenActions={openMessageActions}
            t={t}
          />
        ))}
        <div ref={bottomRef} />
      </section>

      {actionMenu && selectedActionMessage ? (
        <>
          <div aria-hidden="true" className="message-actions-backdrop" />
          <MessageActionsPopover
            actionMenu={actionMenu}
            currentUserId={currentUser?.id}
            message={selectedActionMessage}
            onDelete={handleDelete}
            onEdit={startEdit}
            onReact={handleReact}
            onReply={startReply}
            runAction={runMessageAction}
            t={t}
          />
        </>
      ) : null}

      {error && messages.length > 0 ? <div className="thread-inline-error">{error}</div> : null}

      <form className="thread-composer" onSubmit={handleSubmit}>
        {editingMessage || replyToMessage ? (
          <div className="thread-composer-context">
            <span>
              {editingMessage
                ? t('editingMessage', 'Редактирование')
                : `${t('replyTo', 'Ответ')}: ${getMessagePreview(replyToMessage)}`}
            </span>
            <button aria-label={t('cancel', 'Отменить')} onClick={cancelComposerMode} type="button">×</button>
          </div>
        ) : null}
        <input
          aria-label={t('message', 'Сообщение')}
          onChange={handleDraftChange}
          onKeyDown={handleComposerKeyDown}
          placeholder={t('messagePlaceholder', 'Сообщение...')}
          value={draft}
        />
        <button disabled={!draft.trim() || isSending} type="submit">
          {isSending ? '⏳' : '➤'}
        </button>
      </form>

      {chat?.type === 'group' && (
        <GroupInfoModal
          chatId={chatId}
          isOpen={isGroupInfoOpen}
          onClose={() => setIsGroupInfoOpen(false)}
          t={t}
        />
      )}

      {profileMode === 'modal' ? (
        <UserProfileModal
          chat={chat}
          error={profileModal.error}
          isLoading={profileModal.isLoading}
          isOpen={profileModal.isOpen}
          onClose={() => setProfileModal({ isOpen: false, isLoading: false, error: '', user: null })}
          t={t}
          user={profileModal.user}
        />
      ) : null}
    </main>
  );
}

function appendUniqueMessage(items, nextMessage) {
  if (items.some((message) => message.id === nextMessage.id)) return items;
  return [...items, nextMessage];
}

function updateMessage(items, messageId, patch) {
  return items.map((message) => (message.id === messageId ? { ...message, ...patch } : message));
}

function renderMessageContent(content) {
  if (!content) return '';
  const parts = [];
  const regex = /(#[\wа-яА-ЯёЁ]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore) {
      parts.push(textBefore);
    }
    const hashtag = match[0];
    parts.push(
      <span
        key={match.index}
        className="hashtag-link"
        style={{ color: 'var(--rd-accent, #ff2d8b)', cursor: 'pointer', fontWeight: 'bold' }}
        onClick={() => {
          if (typeof window.handleUnifiedSearch === 'function') {
            window.handleUnifiedSearch(hashtag);
          } else {
            alert(`Поиск по хэштегу: ${hashtag}`);
          }
        }}
      >
        {hashtag}
      </span>
    );
    lastIndex = regex.lastIndex;
  }

  const textAfter = content.substring(lastIndex);
  if (textAfter) {
    parts.push(textAfter);
  }

  return parts.length > 0 ? parts : content;
}

function MessageBubble({
  currentUserId,
  isActionTarget,
  message,
  onOpenActions,
  t,
}) {
  const mine = message.senderId === currentUserId;
  const longPressTimerRef = useRef(null);
  const longPressPointRef = useRef(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => () => window.clearTimeout(longPressTimerRef.current), []);

  function clearLongPress() {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function handleClickCapture(event) {
    if (!suppressNextClickRef.current) return;
    suppressNextClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleContextMenu(event) {
    event.preventDefault();
    onOpenActions(message, event.currentTarget.getBoundingClientRect());
  }

  function handlePointerDown(event) {
    if (event.button !== 0 || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
    const point = { x: event.clientX, y: event.clientY };
    const rect = event.currentTarget.getBoundingClientRect();
    longPressPointRef.current = point;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = true;
      onOpenActions(message, rect);
    }, 550);
  }

  function handlePointerMove(event) {
    if (!longPressTimerRef.current || !longPressPointRef.current) return;
    const deltaX = Math.abs(event.clientX - longPressPointRef.current.x);
    const deltaY = Math.abs(event.clientY - longPressPointRef.current.y);
    if (deltaX > 8 || deltaY > 8) clearLongPress();
  }

  return (
    <article
      className={`message-bubble ${mine ? 'is-mine' : ''} ${isActionTarget ? 'is-action-target' : ''}`}
      onClickCapture={handleClickCapture}
      onContextMenu={handleContextMenu}
      onPointerCancel={clearLongPress}
      onPointerDown={handlePointerDown}
      onPointerLeave={clearLongPress}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPress}
    >
      {!mine ? (
        <div className="message-sender">
          {/* {message.senderFirstName || message.senderUsername || 'User'} */}
          {message.senderStatusEmoji ? (
            <span className="sender-status-emoji" style={{ marginLeft: 6 }}>
              {message.senderStatusEmoji}
            </span>
          ) : null}
        </div>
      ) : null}
      {message.replyToContent ? <div className="message-reply-preview">{message.replyToContent}</div> : null}
      <MessageMedia message={message} t={t} />
      <div className="message-content">{renderMessageContent(message.content)}</div>
      {message.reactions?.length ? (
        <div className="message-reactions">
          {message.reactions.map((reaction) => (
            <span className={reaction.myReaction ? 'is-mine' : ''} key={reaction.emoji}>
              {reaction.emoji} {reaction.count}
            </span>
          ))}
        </div>
      ) : null}
      <div className="message-meta">
        {message.isEdited ? <span>{t('edited', 'изменено')}</span> : null}
        <time>{formatMessageTime(message.timestamp || message.createdAt)}</time>
      </div>
    </article>
  );
}

function MessageActionsPopover({
  actionMenu,
  currentUserId,
  message,
  onDelete,
  onEdit,
  onReact,
  onReply,
  runAction,
  t,
}) {
  const mine = message.senderId === currentUserId;

  return (
    <div
      className="message-actions-popover"
      onClick={(event) => event.stopPropagation()}
      style={{ left: actionMenu.x, top: actionMenu.y }}
    >
      <div className="message-reaction-actions">
        <button onClick={() => runAction(() => onReact(message, '👍'))} type="button">👍</button>
        <button onClick={() => runAction(() => onReact(message, '❤️'))} type="button">❤️</button>
      </div>
      <div className="message-text-actions">
        <button onClick={() => runAction(() => onReply(message))} type="button">{t('reply', 'Ответить')}</button>
        {mine ? <button onClick={() => runAction(() => onEdit(message))} type="button">{t('edit', 'Редактировать')}</button> : null}
        {mine ? <button onClick={() => runAction(() => onDelete(message))} type="button">{t('delete', 'Удалить')}</button> : null}
      </div>
    </div>
  );
}

function MessageMedia({ message, t }) {
  if (message.mediaUnavailable) {
    return (
      <div className="message-media-unavailable">
        {message.mediaUnavailableReason || t('mediaUnavailableUnencrypted', 'Медиа недоступно: файл не зашифрован')}
      </div>
    );
  }

  if (!message.mediaUrl) return null;

  const type = message.mediaType || message.type;
  if (type === 'image' || type === 'gif' || type === 'sticker') {
    return <img alt="" className={`message-media message-media-${type}`} src={message.mediaUrl} />;
  }
  if (type === 'video') {
    return <video className="message-media" controls src={message.mediaUrl} />;
  }
  if (type === 'audio' || type === 'voice') {
    return <audio className="message-media" controls src={message.mediaUrl} />;
  }
  if (type === 'file') {
    return (
      <a className="message-media-file" download href={message.mediaUrl}>
        {t('downloadFile', 'Скачать файл')}
      </a>
    );
  }

  return null;
}

function UserProfileModal({ chat, error, isLoading, isOpen, onClose, t, user }) {
  if (!isOpen) return null;

  return (
    <div className="user-profile-modal" onClick={onClose} role="presentation">
      <UserProfilePanel
        chat={chat}
        error={error}
        isLoading={isLoading}
        onClose={onClose}
        stopPropagation
        t={t}
        user={user}
      />
    </div>
  );
}

export function UserProfilePanel({ chat, error, isLoading, onClose, stopPropagation = false, t, user }) {
  const [editableUser, setEditableUser] = useState(user);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ firstName: '', bio: '' });
  const [editError, setEditError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { initiateCall } = useCall();
  const currentUser = getCurrentUser();
  const profileUser = editableUser || user;
  const isOwnProfile = Boolean(profileUser?.id && currentUser?.id && profileUser.id === currentUser.id);
  const displayName = [profileUser?.firstName, profileUser?.lastName].filter(Boolean).join(' ')
    || profileUser?.username
    || chat?.name
    || chat?.title
    || t('user', 'Пользователь');
  const username = profileUser?.username ? `@${profileUser.username}` : '';
  const status = profileUser?.isBot
    ? t('bot', 'бот')
    : getChatSubtitle(chat, null, t);
  const avatarUrl = profileUser?.avatarUrl || chat?.avatarUrl || '';
  const canCall = Boolean(chat?.id);

  useEffect(() => {
    setEditableUser(user);
    setIsEditing(false);
    setEditError('');
  }, [user]);

  function startAudioCall() {
    if (!canCall) return;
    initiateCall(chat.id, chat?.type, displayName, 'audio');
  }

  function startVideoCall() {
    if (!canCall) return;
    initiateCall(chat.id, chat?.type, displayName, 'video');
  }

  function copyText(value) {
    if (!value || !navigator?.clipboard) return;
    navigator.clipboard.writeText(value).catch(() => {});
  }

  function startEdit() {
    setEditDraft({
      firstName: profileUser?.firstName || displayName,
      bio: profileUser?.bio || '',
    });
    setEditError('');
    setIsEditing(true);
  }

  async function saveProfileEdit(event) {
    event.preventDefault();
    setIsSaving(true);
    setEditError('');
    try {
      const updated = await services.userService.updateMe({
        firstName: editDraft.firstName.trim(),
        bio: editDraft.bio,
      });
      setEditableUser(updated);
      setIsEditing(false);
    } catch (err) {
      setEditError(err.message || t('profileSaveError', 'Не удалось сохранить профиль'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-label={t('profile', 'Профиль')}
      className="user-profile-card"
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
    >
      <header className="user-profile-header">
        <button className="user-profile-back" onClick={onClose} type="button">
          <span aria-hidden="true">‹</span>
          {t('back', 'Назад')}
        </button>
        <strong>{t('information', 'Информация')}</strong>
        {isOwnProfile ? (
          <button className="user-profile-edit" onClick={isEditing ? () => setIsEditing(false) : startEdit} type="button">
            {isEditing ? t('cancel', 'Отмена') : t('editShort', 'Изм.')}
          </button>
        ) : <span />}
      </header>

      {isLoading ? (
        <div className="user-profile-state">{t('loading', 'Загрузка...')}</div>
      ) : error ? (
        <div className="user-profile-state is-error">{error}</div>
      ) : (
        <div className="user-profile-scroll">
          <div className="user-profile-hero">
            <div className="user-profile-avatar">
              {avatarUrl ? <img alt="" src={avatarUrl} /> : <Identicon userId={profileUser?.id || chat?.peerId || displayName} size={112} />}
            </div>
            <h2>{displayName}</h2>
            <p className={`user-profile-status ${chat?.peerIsOnline ? 'is-online' : ''}`}>{status}</p>
          </div>

          <div className="user-profile-actions">
            <button onClick={onClose} type="button">
              <MessageCircleIcon />
              {t('chat', 'Чат')}
            </button>
            <button disabled={!canCall} onClick={startAudioCall} type="button">
              <PhoneIcon />
              {t('call', 'Звонок')}
            </button>
            <button disabled={!canCall} onClick={startVideoCall} title={t('videoCall', 'Видеозвонок')} type="button">
              <VideoIcon />
              {t('video', 'Видео')}
            </button>
          </div>

          {isEditing ? (
            <form className="user-profile-edit-form" onSubmit={saveProfileEdit}>
              <label>
                <span>{t('name', 'Имя')}</span>
                <input
                  onChange={(event) => setEditDraft((draft) => ({ ...draft, firstName: event.target.value }))}
                  value={editDraft.firstName}
                />
              </label>
              <label>
                <span>{t('bio', 'О себе')}</span>
                <textarea
                  onChange={(event) => setEditDraft((draft) => ({ ...draft, bio: event.target.value }))}
                  rows={4}
                  value={editDraft.bio}
                />
              </label>
              {editError ? <p>{editError}</p> : null}
              <button disabled={isSaving || !editDraft.firstName.trim()} type="submit">
                {isSaving ? t('saving', 'Сохранение...') : t('save', 'Сохранить')}
              </button>
            </form>
          ) : (
            <div className="user-profile-info-card">
              {username ? (
                <button className="user-profile-copy-row" onClick={() => copyText(username)} type="button">
                  <span>{t('username', 'Имя пользователя')}</span>
                  <strong>{username}</strong>
                  <CopyIcon />
                </button>
              ) : null}
              <div className="user-profile-info-row">
                <span>{t('bio', 'О себе')}</span>
                <strong>{profileUser?.bio || t('profileBioEmpty', 'Информация не указана')}</strong>
              </div>
            </div>
          )}

          <div className="user-profile-tabs">
            <button className="active" type="button">{t('media', 'Медиа')}</button>
          </div>
          <div className="user-profile-empty-media">
            {t('profileMediaEmpty', 'Медиа пока не загружены')}
          </div>
        </div>
      )}
    </section>
  );
}

function MessageCircleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M21 11.8a8.4 8.4 0 0 1-8.7 8.2 9.2 9.2 0 0 1-3.6-.74L4 20.5l1.22-4.1A8 8 0 0 1 4 12.08 8.4 8.4 0 0 1 12.7 4 8.4 8.4 0 0 1 21 11.8Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6.62 5.12c.5-.5 1.31-.5 1.81 0l2.12 2.12c.43.43.5 1.1.16 1.62l-.95 1.45a10.65 10.65 0 0 0 4.01 4.01l1.45-.95c.52-.34 1.19-.27 1.62.16l2.12 2.12c.5.5.5 1.31 0 1.81l-.94.94c-.96.96-2.37 1.31-3.65.87A16.4 16.4 0 0 1 4.81 9.72c-.44-1.28-.09-2.69.87-3.65l.94-.95Z" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5.8 7h7.7A3.5 3.5 0 0 1 17 10.5v.55l2.4-1.78A1 1 0 0 1 21 10.08v3.84a1 1 0 0 1-1.6.8L17 12.95v.55a3.5 3.5 0 0 1-3.5 3.5H5.8A3.8 3.8 0 0 1 2 13.2v-2.4A3.8 3.8 0 0 1 5.8 7Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 7.5A2.5 2.5 0 0 1 10.5 5H18a2.5 2.5 0 0 1 2.5 2.5V15A2.5 2.5 0 0 1 18 17.5h-7.5A2.5 2.5 0 0 1 8 15V7.5Zm-4.5 2A2.5 2.5 0 0 1 6 7h.5v2H6a.5.5 0 0 0-.5.5V18a.5.5 0 0 0 .5.5h8.5a.5.5 0 0 0 .5-.5v-.5h2v.5a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V9.5Z" />
    </svg>
  );
}

function ThreadSkeleton() {
  return (
    <div className="thread-skeleton">
      <div className="message-bubble"><div className="skeleton-line skeleton-message" /></div>
      <div className="message-bubble is-mine"><div className="skeleton-line skeleton-message-short" /></div>
      <div className="message-bubble"><div className="skeleton-line skeleton-message" /></div>
    </div>
  );
}

function ThreadState({ message, title }) {
  return (
    <div className="thread-state">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('craneapp_user_data') || 'null');
  } catch (_error) {
    return null;
  }
}

function formatMessageTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getMessagePreview(message) {
  if (!message) return '';
  return String(message.content || '').slice(0, 64);
}

function getChatSubtitle(chat, typingUserId, t) {
  if (typingUserId) return t('typing', 'печатает...');
  if (chat?.type === 'group') return t('groupChat', 'Группа');
  if (chat?.peerIsOnline) return t('online', 'онлайн');
  if (chat?.peerLastSeen) return formatLastSeen(chat.peerLastSeen, t);
  return t('lastSeenRecently', 'был(а) недавно');
}

function formatLastSeen(value, t) {
  if (value === 'recently') return t('lastSeenRecently', 'был(а) недавно');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('lastSeenRecently', 'был(а) недавно');

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const formatted = new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
  ).format(date);

  return t('lastSeenAt', 'был(а) {time}', { time: formatted }).replace('{time}', formatted);
}

function fallbackTranslate(_key, fallback) {
  return fallback;
}
