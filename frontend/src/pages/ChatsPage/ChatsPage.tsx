import {
  ArchiveEntry,
  ChatListItem,
  ChatListItemSkeleton,
  ChatsSearchField,
  ChatsSearchResults,
  CreateGroupModal,
  EmptyChatListPlaceholder,
  ErrorChatListPlaceholder,
  UserProfilePanel,
} from '@/components/features';
import { Icon } from '@/shared/ui';
import { useChatsSearch } from '@/hooks';
import { useIsMobile, usePaneWidth } from '@/shared/lib';
import { isConversationStarted } from '@/entities/chat';
import { PaneResizer } from './PaneResizer';
import { chatsQuery } from '@/queries/chats/chatsQuery';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useParams } from 'react-router-dom';
import type { IProfileState } from '@/entities/user';

/* Границы ширины колонок. Ниже нижней строка чата перестаёт помещаться,
   выше верхней колонка съедает переписку. */
const SIDEBAR_LIMITS = { min: 280, max: 520, fallback: 360 };
const PROFILE_LIMITS = { min: 300, max: 560, fallback: 380 };

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
  const pinnedCount = useMemo(
    () => visibleChats.filter((chat) => chat.isPinned).length,
    [visibleChats]
  );
  const search = useChatsSearch(visibleChats);
  const isMobile = useIsMobile();
  const sidebar = usePaneWidth('sidebar', SIDEBAR_LIMITS);
  const profile = usePaneWidth('profile', PROFILE_LIMITS);
  const [profileState, setProfileState] = useState<IProfileState>({
    isOpen: false,
    userId: null,
    chat: null,
    messages: [],
  });
  const [profileCloseToken, setProfileCloseToken] = useState(0);
  const [isCreateGroupOpen, setCreateGroupOpen] = useState(false);
  const [isArchiveOpen, setArchiveOpen] = useState(false);

  /* Архив грузится всегда, даже когда закрыт: по нему решается, показывать
     ли строку входа и сколько там непрочитанных. Запрос лёгкий и живёт в
     том же кеше, что и основной список. */
  const { data: archivedChats = [] } = useQuery(chatsQuery({ archived: true }));

  /* Опустевший архив закрывается сам: человек вернул оттуда последний чат
     и остался бы смотреть в пустой экран, из которого надо выбираться
     кнопкой. Состояние при этом не сбрасывается — архив снова наполнится,
     и он откроется там же. */
  const showArchive = isArchiveOpen && archivedChats.length > 0;
  const { t } = useTranslation();

  function startResize(kind: 'sidebar' | 'profile', event: PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const pane = kind === 'sidebar' ? sidebar : profile;
    const limits = kind === 'sidebar' ? SIDEBAR_LIMITS : PROFILE_LIMITS;
    const startWidth = pane.width;
    let lastWidth = startWidth;

    function handleMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      // Панель профиля растёт влево, поэтому смещение у неё с обратным знаком.
      const raw = kind === 'sidebar' ? startWidth + delta : startWidth - delta;

      lastWidth = Math.min(Math.max(raw, limits.min), limits.max);
      pane.setWidth(lastWidth);
    }

    function handleUp() {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      // Записывается один раз, по концу: иначе одно перетаскивание даёт
      // несколько сотен обращений к хранилищу.
      pane.remember(lastWidth);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  const createGroupModal = isCreateGroupOpen ? (
    <CreateGroupModal onClose={() => setCreateGroupOpen(false)} />
  ) : null;

  const archiveHeader = (
    <section className="chats-toolbar">
      <button
        aria-label={t('back', 'Назад')}
        className="chats-new-group"
        onClick={() => setArchiveOpen(false)}
        type="button"
      >
        <Icon name="chevronRight" className="rotate-180" />
      </button>
      <h1 className="text-section font-semibold text-ink">{t('archive', 'Архив')}</h1>
    </section>
  );

  const archiveContent = (
    <>
      {archiveHeader}
      <section className="chats-list styled-scrollbar">
        {archivedChats.map((chat) => (
          <ChatListItem chat={chat} key={chat.id} pinnedCount={pinnedCount} />
        ))}
      </section>
    </>
  );

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

        {!isLoading && !error && !search.isSearching && (
          <ArchiveEntry chats={archivedChats} onOpen={() => setArchiveOpen(true)} />
        )}

        {!isLoading && !error && !search.isSearching && visibleChats.length === 0 && (
          <EmptyChatListPlaceholder />
        )}
        {!isLoading &&
          !error &&
          !search.isSearching &&
          visibleChats.map((chat) => (
            <ChatListItem chat={chat} key={chat.id} pinnedCount={pinnedCount} />
          ))}
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
        <main className="chats-page">{showArchive ? archiveContent : listContent}</main>
      </>
    );
  }

  return (
    <div className={`chat-workspace ${profileState.isOpen ? 'has-profile' : ''}`}>
      {/* Окно рисуется вне колонки списка: у той backdrop-filter, а он
          делает position: fixed относительным ей, и окно оказывалось
          прижатым к узкой колонке вместо экрана. */}
      {createGroupModal}
      <div className="app-sidebar-pane" style={{ flexBasis: sidebar.width }}>
        <main className="chats-page">{showArchive ? archiveContent : listContent}</main>
      </div>

      <PaneResizer
        className="app-pane-resizer app-pane-resizer-sidebar"
        label={t('resizeChatList', 'Изменить ширину списка чатов')}
        max={SIDEBAR_LIMITS.max}
        min={SIDEBAR_LIMITS.min}
        onPointerDown={(event) => startResize('sidebar', event.nativeEvent)}
        onJump={sidebar.jump}
        onNudge={sidebar.nudge}
        width={sidebar.width}
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
          <PaneResizer
            className="app-pane-resizer app-pane-resizer-profile"
            label={t('resizeProfile', 'Изменить ширину профиля')}
            max={PROFILE_LIMITS.max}
            min={PROFILE_LIMITS.min}
            onPointerDown={(event) => startResize('profile', event.nativeEvent)}
            onJump={profile.jump}
            onNudge={profile.nudge}
            width={profile.width}
          />
          <div className="app-profile-pane" style={{ flexBasis: profile.width }}>
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
