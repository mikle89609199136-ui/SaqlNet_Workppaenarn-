import {
  ChatListItem,
  ChatListItemSkeleton,
  chatsQuery,
  isConversationStarted,
} from '@/entities/chat';
import { ChatsSearchField, ChatsSearchResults, useChatsSearch } from '@/features/search';
import { ChatRowMenu } from '@/features/chat-actions';
import { Icon } from '@/shared/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveEntry } from './ArchiveEntry';
import { EmptyChatListPlaceholder } from './EmptyChatListPlaceholder';
import { ErrorChatListPlaceholder } from './ErrorChatListPlaceholder';

interface Props {
  onOpenCreateGroup: () => void;
}

export function ChatsList({ onOpenCreateGroup }: Props) {
  const { t } = useTranslation();
  const [isArchiveOpen, setArchiveOpen] = useState(false);

  const {
    data: chats = [],
    isPending: isLoading,
    error: loadError,
    refetch: refetchChats,
  } = useQuery(chatsQuery());
  const error = loadError ? (loadError as Error).message : '';

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

  /* Архив грузится всегда, даже когда закрыт: по нему решается, показывать
     ли строку входа и сколько там непрочитанных. Запрос лёгкий и живёт в
     том же кеше, что и основной список. */
  const { data: archivedChats = [] } = useQuery(chatsQuery({ archived: true }));

  /* Опустевший архив закрывается сам: человек вернул оттуда последний чат
     и остался бы смотреть в пустой экран, из которого надо выбираться
     кнопкой. Состояние при этом не сбрасывается — архив снова наполнится,
     и он откроется там же. */
  const showArchive = isArchiveOpen && archivedChats.length > 0;

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
          <ChatListItem
            chat={chat}
            key={chat.id}
            pinnedCount={pinnedCount}
            renderMenu={(props) => <ChatRowMenu {...props} />}
          />
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
          onClick={onOpenCreateGroup}
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
            <ChatListItem
              chat={chat}
              key={chat.id}
              pinnedCount={pinnedCount}
              renderMenu={(props) => <ChatRowMenu {...props} />}
            />
          ))}
      </section>
    </>
  );

  return <main className="chats-page">{showArchive ? archiveContent : listContent}</main>;
}
