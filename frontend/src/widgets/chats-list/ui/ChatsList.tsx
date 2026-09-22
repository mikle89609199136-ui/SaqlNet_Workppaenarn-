import {
  ChatListItem,
  ChatListItemSkeleton,
  chatsQuery,
  isConversationStarted,
} from '@/entities/chat';
import { ChatsSearchField, ChatsSearchResults, useChatsSearch } from '@/features/search';
import { ChatRowMenu } from '@/features/chat-actions';
import { Button, Icon } from '@/shared/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveEntry } from './ArchiveEntry';
import { EmptyChatListPlaceholder } from './EmptyChatListPlaceholder';
import { ErrorChatListPlaceholder } from './ErrorChatListPlaceholder';

/* Экран списка чатов — один и тот же на телефоне и на настольном, но
   собран по-разному, и это не вкус: на телефоне прокручивается вся
   страница целиком, на настольном — только список внутри колонки,
   а колонка занимает высоту экрана. Поэтому всё, что относится к
   настольному, помечено `md:`.

   Порог здесь тот же, что у `useIsMobile`: им решается, какое дерево
   вообще отрисуется — `mobile-layout` или `app-sidebar-pane`. Разойдись
   они хоть на пиксель, и часть правил применилась бы к чужому дереву.

   Отступ сверху — 18 пикселей плюс вырез экрана, и он остаётся и на
   настольном: значения из кита, менять их здесь нельзя, иначе список
   уедет под строку состояния. Внизу на телефоне те же 24 пикселя
   заменяются на высоту нижней навигации — список уходит под неё. */
const pageStyles =
  'relative mx-auto min-h-dvh max-w-[920px] px-3.5 ' +
  'pt-[calc(18px_+_env(safe-area-inset-top,0px))] ' +
  'pb-[calc(24px_+_env(safe-area-inset-bottom,0px))] ' +
  'max-md:pb-safe-nav ' +
  'md:flex md:h-full md:min-h-full md:w-full md:max-w-full md:flex-col md:overflow-hidden md:px-0 md:pb-0';

/* Панель над списком. На телефоне прокручивается вся страница, и панель
   уезжала вверх вместе с ней — на настольном она остаётся на месте,
   потому что там прокручивается только список. Липкой она ведёт себя
   одинаково в обоих случаях; фон обязателен, иначе под ней просвечивают
   строки. */
const toolbarStyles =
  'mb-3 flex items-center gap-2 ' +
  'md:mb-4 md:px-4 ' +
  'max-md:sticky max-md:top-[env(safe-area-inset-top,0px)] max-md:z-10 max-md:bg-ground max-md:py-2';

/* Прокрутка на настольном — у списка, а не у страницы: шапка с поиском
   обязана остаться на виду. */
const listStyles = 'styled-scrollbar overflow-hidden md:flex-1 md:overflow-y-auto';

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
    <section className={toolbarStyles}>
      <Button
        aria-label={t('back', 'Назад')}
        className="size-11 shrink-0 p-0 text-ink-2 hover:text-ink"
        iconOnly
        onClick={() => setArchiveOpen(false)}
        size="lg"
        variant="secondary"
      >
        <Icon name="chevronRight" className="rotate-180" />
      </Button>
      <h1 className="text-section font-semibold text-ink">{t('archive', 'Архив')}</h1>
    </section>
  );

  const archiveContent = (
    <>
      {archiveHeader}
      <section className={listStyles}>
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
      <section className={toolbarStyles}>
        <ChatsSearchField onChange={search.setQuery} onReset={search.reset} value={search.query} />

        {/* Кнопка новой группы: раньше создать её было нельзя вовсе —
            страница существовала, а ссылки на неё не было ни на одном
            экране. */}
        <Button
          aria-label={t('newGroup', 'Новая группа')}
          className="size-11 shrink-0 p-0 text-ink-2 hover:text-ink"
          iconOnly
          onClick={onOpenCreateGroup}
          size="lg"
          title={t('newGroup', 'Новая группа')}
          variant="secondary"
        >
          <Icon name="groupAdd" />
        </Button>
      </section>

      <section aria-busy={isLoading} className={listStyles}>
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

  return <main className={pageStyles}>{showArchive ? archiveContent : listContent}</main>;
}
