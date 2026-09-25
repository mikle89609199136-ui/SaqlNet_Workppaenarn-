import { useCall } from '@/features/call';
import type { TConnectionStatus } from '@/realtime/connectionStatus';
import type { IProfileModal } from '@/entities/user';
import { chatQuery, useTypingStore } from '@/entities/chat';
import { cn, getChatSubtitle, useConnectionStatus } from '@/shared/lib';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Avatar, Icon } from '@/shared/ui';
import { useBlockedUsers } from '@/features/blocked-users';

/**
 * Что сказать вместо «был(а) недавно», пока связи нет.
 *
 * Состояние связи важнее всего остального: если сообщения не ходят, знать
 * о собеседнике, что он «онлайн», человеку незачем — эти сведения тех же
 * секунд, что и молчащий чат.
 */
function connectionSubtitle(status: TConnectionStatus, t: TFunction): string | null {
  if (status === 'connected') return null;

  return status === 'offline' ? t('noNetwork', 'Нет сети') : t('connecting', 'Соединяемся…');
}

interface Props {
  setIsGroupInfoOpen?: Dispatch<SetStateAction<boolean>>;
  profileModal?: IProfileModal;
  setProfileModal?: Dispatch<SetStateAction<IProfileModal>>;
  locationPage?: 'pinned-messages' | 'chat-thread';
  onClosePinnedMessagePage?: () => void;
}

export const ChatThreadHeader = ({
  setIsGroupInfoOpen,
  profileModal,
  setProfileModal,
  locationPage = 'chat-thread',
  onClosePinnedMessagePage,
}: Props) => {
  const { t } = useTranslation();
  const { chatId = '' } = useParams<{ chatId: string }>();
  const connection = useConnectionStatus();
  // Заголовок читает чат из кеша запросов — того же, что наполняет страница.
  const { data: chat } = useQuery(chatQuery(chatId));
  const { initiateCall } = useCall();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const [showCallMenu, setShowCallMenu] = useState(false);
  const typingUserId = useTypingStore((state) => state.typingByChat[chatId] ?? null);
  const { isUserBlocked } = useBlockedUsers();

  if (!chat) return;

  const isPeerBlocked = Boolean(
    chat.type === 'private' && chat.peerId && isUserBlocked(chat.peerId)
  );
  const noticeSubtitle = connectionSubtitle(connection, t);
  const subtitle = isPeerBlocked
    ? t('settings.privacy.userBlocked', 'Заблокирован')
    : (noticeSubtitle ?? getChatSubtitle(chat, typingUserId, t));
  const isPeerOnline = Boolean(!isPeerBlocked && chat.type === 'private' && chat?.peerIsOnline);

  const handleCallClick = () => {
    if (isPeerBlocked || isLongPress.current) return;
    if (showCallMenu) {
      setShowCallMenu(false);
      return;
    }
    initiateCall(chatId, chat.type, chat.title, 'audio', chat?.peerId);
  };

  const handleTouchStart = () => {
    isLongPress.current = false;
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      setShowCallMenu((prev) => !prev);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  // Клик по шапке только называет, чей профиль показать: запрос делает
  // панель, и повторное открытие обходится кешем (#232).
  function openChatProfile() {
    if (!setProfileModal) return;

    if (profileModal?.isOpen) {
      setProfileModal({ isOpen: false, userId: null });
      return;
    }

    if (chat?.type === 'group' && setIsGroupInfoOpen) {
      setIsGroupInfoOpen(true);
      return;
    }
    if (chat?.type !== 'private' || !chat.peerId) return;

    setProfileModal({ isOpen: true, userId: chat.peerId });
  }

  return (
    <header className="thread-header">
      {locationPage === 'chat-thread' && (
        <Link aria-label={t('back', 'Назад')} className="thread-back" to="/chats">
          <svg
            fill="none"
            height="27"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
            viewBox="3 0 20 22"
            width="27"
          >
            <line x1="19" x2="5" y1="12" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </Link>
      )}

      {locationPage === 'pinned-messages' && (
        <button
          aria-label={t('back', 'Назад')}
          className="pinned-thread-back p-2 cursor-pointer"
          onClick={onClosePinnedMessagePage}
        >
          <svg
            fill="none"
            className="size-6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
            viewBox="3 0 20 22"
          >
            <line x1="19" x2="5" y1="12" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
      )}

      {locationPage === 'chat-thread' && (
        <>
          <div
            className="thread-header-card thread-header-info"
            onClick={openChatProfile}
            style={{
              cursor: chat?.type === 'group' || chat?.type === 'private' ? 'pointer' : 'default',
            }}
          >
            <button
              aria-label={chat.title}
              className={'cursor-pointer'}
              tabIndex={-1}
              type="button"
            >
              <Avatar
                id={chat.type === 'private' ? chat.peerId : null}
                name={chat.title}
                online={isPeerOnline}
                size="lg"
                src={chat.avatarUrl}
              />
            </button>

            <div className="thread-title-wrap">
              <h1>{chat.title}</h1>
              <p className={cn(noticeSubtitle && 'thread-subtitle-notice', isPeerBlocked && 'text-danger font-medium')}>{subtitle}</p>
            </div>
          </div>

          <div className="thread-call-actions-wrap">
            <div className="thread-header-card thread-call-actions thread-call-desktop">
              <button
                className="thread-call-button"
                disabled={isPeerBlocked}
                onClick={() => !isPeerBlocked && initiateCall(chatId, chat.type, chat.title, 'audio', chat?.peerId)}
                title={isPeerBlocked ? t('settings.privacy.userBlocked', 'Заблокирован') : t('audioCall', 'Аудиозвонок')}
                type="button"
              >
                <Icon name="phone" />
              </button>

              <button
                className="thread-call-button"
                disabled={isPeerBlocked}
                onClick={() => !isPeerBlocked && initiateCall(chatId, chat?.type, chat.title, 'video', chat?.peerId)}
                title={isPeerBlocked ? t('settings.privacy.userBlocked', 'Заблокирован') : t('videoCall', 'Видео')}
                type="button"
              >
                <Icon name="video" />
              </button>
            </div>

            <div className="thread-header-card thread-call-mobile">
              <button
                className="thread-call-button"
                disabled={isPeerBlocked}
                onClick={handleCallClick}
                onMouseDown={!isPeerBlocked ? handleTouchStart : undefined}
                onMouseUp={!isPeerBlocked ? handleTouchEnd : undefined}
                onTouchEnd={!isPeerBlocked ? handleTouchEnd : undefined}
                onTouchStart={!isPeerBlocked ? handleTouchStart : undefined}
                title={isPeerBlocked ? t('settings.privacy.userBlocked', 'Заблокирован') : undefined}
                type="button"
              >
                <Icon name="phone" className="thread-call-icon" />
              </button>

              {showCallMenu && (
                <div className="thread-call-menu">
                  <button
                    onClick={() => {
                      setShowCallMenu(false);
                      initiateCall(chatId, chat?.type, chat.title, 'audio', chat?.peerId);
                    }}
                    type="button"
                  >
                    <svg fill="currentColor" height="18" viewBox="0 0 24 24" width="18">
                      <path d="M6.62 10.79a15.053 15.053 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                    </svg>{' '}
                    {/* microphone icon */}
                    {t('audioCall', 'Аудио')}
                  </button>

                  <button
                    onClick={() => {
                      setShowCallMenu(false);
                      initiateCall(chatId, chat?.type, chat.title, 'video', chat?.peerId);
                    }}
                    type="button"
                  >
                    <Icon name="video" />
                    {t('videoCall', 'Видео')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {locationPage === 'pinned-messages' && (
        <div className="thread-header-card thread-header-info flex items-center gap-2 w-full">
          <span className="font-semibold text-body">
            {t('pinnedMessagesTitle', 'Закрепленные сообщения')}
          </span>
        </div>
      )}
    </header>
  );
};
