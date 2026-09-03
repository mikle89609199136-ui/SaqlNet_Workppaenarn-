import {
  ChatListItem,
  ChatListItemSkeleton,
  ChatsSearchField,
  ChatsSearchResults,
  CreateGroupModal,
  EmptyChatListPlaceholder,
  ErrorChatListPlaceholder,
  UserProfilePanel,
} from '@/components/features';
import { Icon } from '@/components/ui';
import { useChatsSearch, useIsMobile } from '@/hooks';
import { isConversationStarted } from '@/utils';
import { chatsQuery } from '@/queries/chats/chatsQuery';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useParams } from 'react-router-dom';
import type { IProfileState } from '..';

export function ChatsPage() {
  const {
    data: chats = [],
    isPending: isLoading,
    error: loadError,
    refetch: refetchChats,
  } = useQuery(chatsQuery());
  const error = loadError ? (loadError as Error).message : '';
  const { chatId } = useParams();

  /* Переписки, которые ещё не начались, в списке не показываются —
     см. `isConversationStarted`. Фильтр стоит здесь, а не в запросе:
     тем же запросом пользуется выбор участников группы, и там нужны все
     собеседники. */
  const visibleChats = useMemo(() => chats.filter(isConversationStarted), [chats]);
  const search = useChatsSearch(visibleChats);
  const isMobile = useIsMobile();
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [profileWidth, setProfileWidth] = useState<number | null>(null);
  const [profileState, setProfileState] = useState<IProfileState>({
    isOpen: false,
    userId: null,
    chat: null,
    messages: [],
  });
  const [profileCloseToken, setProfileCloseToken] = useState(0);
  const [isCreateGroupOpen, setCreateGroupOpen] = useState(false);
  const { t } = useTranslation();

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

  const createGroupModal = isCreateGroupOpen ? (
    <CreateGroupModal onClose={() => setCreateGroupOpen(false)} />
  ) : null;

  const listContent = (
    <>
      <section className="chats-toolbar">
        <ChatsSearchField onChange={search.setQuery} onReset={search.reset} value={search.query} />

        <button
          aria-label={t('newGroup', 'Новая группа')}
          className="chats-new-group"
          onClick={() => setCreateGroupOpen(true)}
          title={t('newGroup', 'Новая группа')}
          type="button"
        >
          <Icon name="groupAdd" />
        </button>
      </section>

      <section className="chats-list styled-scrollbar" aria-busy={isLoading}>
        {isLoading ? <ChatListItemSkeleton /> : null}
        {!isLoading && error && (
          <ErrorChatListPlaceholder message={error} onRetry={() => void refetchChats()} />
        )}

        {/* Пока идёт поиск, список подменяется найденным — как в
            привычных мессенджерах. Открытая переписка справа при этом
            остаётся на месте: раньше поиск уводил на отдельную страницу
            и закрывал её. */}
        {!isLoading && !error && search.isSearching && (
          <ChatsSearchResults
            chats={search.chats}
            isEmpty={search.isEmpty}
            isLoadingPeople={search.isLoadingPeople}
            people={search.people}
          />
        )}

        {!isLoading && !error && !search.isSearching && visibleChats.length === 0 && (
          <EmptyChatListPlaceholder />
        )}
        {!isLoading &&
          !error &&
          !search.isSearching &&
          visibleChats.map((chat) => <ChatListItem chat={chat} key={chat.id} />)}
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
    return (
      <>
        {createGroupModal}
        <main className="chats-page">{listContent}</main>
      </>
    );
  }

  return (
    <div className={`chat-workspace ${profileState.isOpen ? 'has-profile' : ''}`}>
      {/* Окно рисуется вне колонки списка: у той backdrop-filter, а он
          делает position: fixed относительным ей, и окно оказывалось
          прижатым к узкой колонке вместо экрана. */}
      {createGroupModal}
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
                setProfileState({ isOpen: false, userId: null, chat: null, messages: [] });
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
