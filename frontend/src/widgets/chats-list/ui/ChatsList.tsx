import {
  ChatListItem,
  ChatListItemSkeleton,
  chatsQuery,
  isConversationStarted,
} from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { ChatsSearchField, ChatsSearchResults, useChatsSearch } from '@/features/search';
import { ROUTES } from '@/shared/config/routes';
import { Avatar, Button, buttonStyles, Icon, SegmentedControl } from '@/shared/ui';
import type { IChatDto } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChatRowMenuWithActions } from './ChatRowMenuWithActions';
import { EmptyChatListPlaceholder } from './EmptyChatListPlaceholder';
import { ErrorChatListPlaceholder } from './ErrorChatListPlaceholder';

/* Разделы списка — вкладками, как в макете (#818). Каналы и встречи
   спрятаны, пока нет самих функций (#815): вкладка без содержимого — та
   же неработающая кнопка. Порядок — как в макете, чтобы открытая вкладка
   встала на своё место без перестановки соседей. */
type TListTab = 'chats' | 'channels' | 'groups' | 'meetings' | 'archive';

const LIST_TABS: { key: TListTab; fallback: string; hidden?: boolean }[] = [
  { key: 'chats', fallback: 'Чаты' },
  { key: 'channels', fallback: 'Каналы', hidden: true },
  { key: 'groups', fallback: 'Группы' },
  { key: 'meetings', fallback: 'Встречи', hidden: true },
  { key: 'archive', fallback: 'Архив' },
];

const VISIBLE_TABS = LIST_TABS.filter((tab) => !tab.hidden);

interface Props {
  onOpenCreateGroup: () => void;
}

/**
 * Список чатов — колонка на ПК и планшете, главный экран на телефоне.
 *
 * Сверху вниз, как в макете: шапка со своей аватаркой, заголовком и
 * входом в настройки, вкладки разделов, поиск и сам список. Прокручивается
 * только список: шапка, вкладки и поиск остаются на виду.
 */
export function ChatsList({ onOpenCreateGroup }: Props) {
  const { t } = useTranslation();
  const tabsId = useId();
  const me = useProfileStore((state) => state.user);
  const [tab, setTab] = useState<TListTab>('chats');

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
  const groups = useMemo(
    () => visibleChats.filter((chat) => chat.type === 'group'),
    [visibleChats]
  );
  const search = useChatsSearch(visibleChats);

  /* Архив живёт в том же кеше, что и основной список; запрос лёгкий. */
  const { data: archivedChats = [] } = useQuery(chatsQuery({ archived: true }));

  const renderRows = (list: IChatDto[]) =>
    list.map((chat) => (
      <ChatListItem
        chat={chat}
        key={chat.id}
        pinnedCount={pinnedCount}
        renderMenu={(props) => <ChatRowMenuWithActions {...props} />}
      />
    ));

  let content: ReactNode;
  if (isLoading) {
    content = <ChatListItemSkeleton />;
  } else if (error) {
    content = <ErrorChatListPlaceholder message={error} onRetry={() => void refetchChats()} />;
  } else if (search.isSearching) {
    /* Пока идёт поиск, список подменяется найденным — в любой вкладке:
       ищут человека или чат, а не раздел. Открытая переписка справа при
       этом остаётся на месте. */
    content = (
      <ChatsSearchResults
        chats={search.chats}
        isEmpty={search.isEmpty}
        isLoadingPeople={search.isLoadingPeople}
        people={search.people}
      />
    );
  } else if (tab === 'groups') {
    content =
      groups.length > 0 ? (
        renderRows(groups)
      ) : (
        <p className="px-5 py-8 text-center text-ui text-ink-3">
          {t('chatList.groupsEmpty', 'Групп пока нет')}
        </p>
      );
  } else if (tab === 'archive') {
    content = (
      <>
        <p className="mx-2 mb-2 rounded-button bg-sheet-2 px-3 py-2.5 text-meta leading-[1.45] text-ink-2">
          {t('chatList.archiveNote', 'Здесь чаты, которые вы убрали из основного списка.')}
        </p>
        {archivedChats.length > 0 ? (
          renderRows(archivedChats)
        ) : (
          <p className="px-5 py-8 text-center text-ui text-ink-3">
            {t('chatList.archiveEmpty', 'В архиве пусто')}
          </p>
        )}
      </>
    );
  } else {
    content = visibleChats.length > 0 ? renderRows(visibleChats) : <EmptyChatListPlaceholder />;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-sheet">
      <header className="flex items-center gap-3 pt-[calc(18px+env(safe-area-inset-top,0px))] pr-4 pb-3.5 pl-5 md:pt-4.5">
        <Avatar
          id={me?.id}
          name={me?.firstName || me?.username}
          size="header"
          src={me?.avatarUrl}
        />
        <h1 className="min-w-0 flex-1 truncate text-section font-semibold tracking-[-0.01em]">
          {t('chatList.title', 'Сообщения')}
        </h1>
        <Link
          aria-label={t('settings.menu.title', 'Настройки')}
          className={buttonStyles({
            variant: 'secondary',
            iconOnly: true,
            className: 'text-ink-2',
          })}
          title={t('settings.menu.title', 'Настройки')}
          to={ROUTES.SETTINGS}
        >
          <Icon name="settings" size="md" />
        </Link>
      </header>

      <nav aria-label={t('chatList.sections', 'Разделы')} className="mx-4 mb-3">
        <SegmentedControl
          className="w-full"
          onChange={(value) => setTab(value as TListTab)}
          options={VISIBLE_TABS.map(({ key, fallback }) => ({
            value: key,
            label: t(`chatList.tab.${key}`, fallback),
          }))}
          tabs={tabsId}
          value={tab}
        />
      </nav>

      <div className="flex items-center gap-2 px-4 pb-2.5">
        <ChatsSearchField onChange={search.setQuery} onReset={search.reset} value={search.query} />

        {/* Кнопка новой группы. В макете её нет, но создавать группы
            приложение уже умеет, и прятать работающую функцию незачем. */}
        <Button
          aria-label={t('newGroup', 'Новая группа')}
          className="shrink-0 text-ink-2"
          iconOnly
          onClick={onOpenCreateGroup}
          title={t('newGroup', 'Новая группа')}
          variant="secondary"
        >
          <Icon name="groupAdd" size="md" />
        </Button>
      </div>

      <div
        aria-busy={isLoading}
        aria-labelledby={`${tabsId}-${tab}`}
        className="styled-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-[calc(8px+env(safe-area-inset-bottom,0px))]"
        id={`${tabsId}-panel`}
        role="tabpanel"
      >
        {content}
      </div>
    </div>
  );
}
