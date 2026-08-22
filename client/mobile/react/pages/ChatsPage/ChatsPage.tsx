import {
  EmptyChatListPlaceholder,
  ErrorChatListPlaceholder,
  UserProfilePanel,
} from '@/components/components';
import { ChatListItem, ChatsSkeleton } from '@/components/ui';
import { useChatLastMessagePreview, useIsMobile } from '@/hooks';
import { services } from '@/services';
import { useChatsStore } from '@/store';
import { decryptChatLastMessagePreview } from '@/utils';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useParams } from 'react-router-dom';
import type { IProfileState } from '..';

export function ChatsPage() {
  const chats = useChatsStore((state) => state.chats);
  const setChats = useChatsStore((state) => state.setChats);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const { chatId } = useParams();
  const isMobile = useIsMobile();
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [profileWidth, setProfileWidth] = useState<number | null>(null);
  const [profileState, setProfileState] = useState<IProfileState>({
    isOpen: false,
    isLoading: false,
    error: '',
    user: null,
    chat: null,
    messages: [],
  });
  const [profileCloseToken, setProfileCloseToken] = useState(0);
  const { t } = useTranslation();

  const fetchChatsList = () => {
    services.chatService
      .getChats()
      .then((items) =>
        Promise.all(
          items.map(async (chat) => ({
            ...chat,
            lastMessage: chat.lastMessage
              ? await decryptChatLastMessagePreview(chat.id, chat.lastMessage)
              : chat.lastMessage,
          }))
        )
      )
      .then((items) => {
        setChats(items);
        setError('');
      })
      .catch((err) => {
        setError(err.message || t('chatsLoadError', 'Не удалось загрузить чаты'));
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    fetchChatsList();
  }, []);

  useChatLastMessagePreview();

  function startResize(kind: string, event: PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startSidebarWidth = sidebarWidth;
    const startProfileWidth = profileWidth || Math.round(window.innerWidth * 0.25);

    function handleMove(moveEvent: PointerEvent) {
      if (kind === 'sidebar') {
        const nextWidth = Math.min(
          Math.max(startSidebarWidth + moveEvent.clientX - startX, 280),
          520
        );
        setSidebarWidth(nextWidth);
      } else {
        const nextWidth = Math.min(
          Math.max(startProfileWidth - (moveEvent.clientX - startX), 300),
          560
        );
        setProfileWidth(nextWidth);
      }
    }

    function handleUp() {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  const listContent = (
    <>
      <section className="chats-toolbar">
        <Link
          className="chats-search"
          to="/contacts"
          aria-label={t('search', 'Поиск чатов и людей...')}
        >
          <span className="chats-search-placeholder">{t('search', 'Поиск чатов и людей...')}</span>
        </Link>
      </section>

      <section className="chats-list styled-scrollbar" aria-busy={isLoading}>
        {isLoading ? <ChatsSkeleton /> : null}
        {!isLoading && error && (
          <ErrorChatListPlaceholder message={error} onRetry={fetchChatsList} />
        )}
        {!isLoading && !error && chats.length === 0 && <EmptyChatListPlaceholder />}
        {!isLoading && !error && chats.map((chat) => <ChatListItem chat={chat} key={chat.id} />)}
      </section>
    </>
  );

  if (isMobile) {
    if (chatId) {
      return (
        <Outlet
          context={{
            onProfileStateChange: setProfileState,
            profileCloseToken,
            profileMode: 'modal',
          }}
        />
      );
    }
    return <main className="chats-page">{listContent}</main>;
  }

  return (
    <div className={`chat-workspace ${profileState.isOpen ? 'has-profile' : ''}`}>
      <div className="app-sidebar-pane" style={{ flexBasis: sidebarWidth }}>
        <main className="chats-page">{listContent}</main>
      </div>

      <div
        aria-label="Изменить ширину списка чатов"
        className="app-pane-resizer app-pane-resizer-sidebar"
        onPointerDown={(event) => startResize('sidebar', event.nativeEvent)}
        role="separator"
      />

      <div className="app-chat-pane">
        <Outlet
          context={{
            onProfileStateChange: setProfileState,
            profileCloseToken,
            profileMode: 'panel',
          }}
        />
      </div>

      {profileState.isOpen && (
        <>
          <div
            aria-label="Изменить ширину профиля"
            className="app-pane-resizer app-pane-resizer-profile"
            onPointerDown={(event) => startResize('profile', event.nativeEvent)}
            role="separator"
          />
          <div
            className="app-profile-pane"
            style={profileWidth ? { flexBasis: profileWidth } : undefined}
          >
            <UserProfilePanel
              onClose={() => {
                setProfileState({
                  isOpen: false,
                  isLoading: false,
                  error: '',
                  user: null,
                  chat: null,
                  messages: [],
                });
                setProfileCloseToken((value) => value + 1);
              }}
              profileState={profileState}
            />
          </div>
        </>
      )}
    </div>
  );
}
