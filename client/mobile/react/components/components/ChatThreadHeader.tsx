import { useCall } from '@/hooks';
import type { IProfileModal } from '@/pages';
import { services } from '@/services';
import { useChatStore } from '@/store';
import { cn, getChatSubtitle } from '@/utils';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Icon, Identicon } from '../ui';

interface Props {
  typingUserId?: string | null;
  setIsGroupInfoOpen?: Dispatch<SetStateAction<boolean>>;
  profileModal?: IProfileModal;
  setProfileModal?: Dispatch<SetStateAction<IProfileModal>>;
  locationPage?: 'pinned-messages' | 'chat-thread';
  onClosePinnedMessagePage?: () => void;
}

export const ChatThreadHeader = ({
  typingUserId,
  setIsGroupInfoOpen,
  profileModal,
  setProfileModal,
  locationPage = 'chat-thread',
  onClosePinnedMessagePage,
}: Props) => {
  const { t } = useTranslation();
  const chat = useChatStore((state) => state.chat);
  const { chatId = '' } = useParams<{ chatId: string }>();
  const { initiateCall } = useCall();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const [showCallMenu, setShowCallMenu] = useState(false);

  if (!chat) return;

  const subtitle = getChatSubtitle(chat, typingUserId, t);
  const isPeerOnline = Boolean(chat.type === 'private' && chat?.peerIsOnline);

  const handleCallClick = () => {
    if (isLongPress.current) return;
    if (showCallMenu) {
      setShowCallMenu(false);
      return;
    }
    initiateCall(chatId, chat.type, chat.title, 'audio');
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

  async function openChatProfile() {
    if (!setProfileModal) return;

    if (profileModal?.isOpen) {
      setProfileModal({ isOpen: false, isLoading: false, error: '', user: null });
      return;
    }

    if (chat?.type === 'group' && setIsGroupInfoOpen) {
      setIsGroupInfoOpen(true);
      return;
    }
    if (chat?.type !== 'private' || !chat.peerId) return;

    setProfileModal({ isOpen: true, isLoading: true, error: '', user: null });
    try {
      const profile = await services.userService.getProfile(chat.peerId);
      setProfileModal({
        isOpen: true,
        isLoading: false,
        error: '',
        user: profile,
      });
    } catch (err: any) {
      setProfileModal({
        isOpen: true,
        isLoading: false,
        error: err.message || t('profileLoadError', 'Не удалось загрузить профиль'),
        user: null,
      });
    }
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
              className={cn("thread-avatar", isPeerOnline && 'is-online')}
              tabIndex={-1}
              type="button"
            >
              {chat.avatarUrl ? (
                <img alt="" src={chat.avatarUrl} />
              ) : chat?.type === 'private' && chat?.peerId ? (
                <Identicon size={50} userId={chat.peerId} />
              ) : (
                chat.title.slice(0, 1).toUpperCase()
              )}
            </button>

            <div className="thread-title-wrap">
              <h1>{chat.title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>

          <div className="thread-call-actions-wrap">
            <div className="thread-header-card thread-call-actions thread-call-desktop">
              <button
                className="thread-call-button"
                onClick={() => initiateCall(chatId, chat.type, chat.title, 'audio', chat?.peerId)}
                title={t('audioCall', 'Аудиозвонок')}
                type="button"
              >
                <Icon name='phone' className='thread-call-icon stroke-transparent fill-current' />
              </button>

              <button
                className="thread-call-button"
                onClick={() => initiateCall(chatId, chat?.type, chat.title, 'video', chat?.peerId)}
                title={t('videoCall', 'Видео')}
                type="button"
              >
                <Icon name='video' className='thread-call-icon thread-call-icon-video stroke-transparent fill-current' />
              </button>
            </div>

            <div className="thread-header-card thread-call-mobile">
              <button
                className="thread-call-button"
                onClick={handleCallClick}
                onMouseDown={handleTouchStart}
                onMouseUp={handleTouchEnd}
                onTouchEnd={handleTouchEnd}
                onTouchStart={handleTouchStart}
                type="button"
              >
                <Icon name='phone' className='thread-call-icon' />
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
                    </svg> {/* microphone icon */}
                    {t('audioCall', 'Аудио')}
                  </button>

                  <button
                    onClick={() => {
                      setShowCallMenu(false);
                      initiateCall(chatId, chat?.type, chat.title, 'video', chat?.peerId);
                    }}
                    type="button"
                  >
                    <Icon name='video' />
                    {t('videoCall', 'Видео')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {locationPage === 'pinned-messages' && (
        <div className="thread-header-card thread-header-info">
          {t('pinnedMessagesTitle', 'Закрепленные сообщения')}
        </div>
      )}
    </header>
  );
};
