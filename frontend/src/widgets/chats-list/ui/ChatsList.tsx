import {
  ChatListItem,
  ChatListItemSkeleton,
  chatsQuery,
  isConversationStarted,
  useChatUiStore,
} from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { ChatsSearchField, ChatsSearchResults, useChatsSearch } from '@/features/search';
import { AppUpdateBanner } from '@/features/app-update';
import { useOpenSavedMessages, useStartPrivateChat } from '@/features/chat-actions';
import { PushPrompt } from '@/features/push-notifications';
import { ROUTES } from '@/shared/config/routes';
import { useConnectionStatus } from '@/shared/lib';
import { Avatar, buttonStyles, Icon, SegmentedControl, Spinner } from '@/shared/ui';
import type { IChatDto } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { CallHistoryList } from '@/features/call';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ChatRowMenuWithActions } from './ChatRowMenuWithActions';
import { EmptyChatListPlaceholder } from './EmptyChatListPlaceholder';
import { ErrorChatListPlaceholder } from './ErrorChatListPlaceholder';
import { VirtualChatList } from './VirtualChatList';

/* Разделы списка — вкладками, как в макете (#818). Каналы спрятаны, пока
   нет самой функции (#815): вкладка без содержимого — та же неработающая
   кнопка. Порядок — как в макете, чтобы открытая вкладка встала на своё
   место без перестановки соседей. Во вкладке «Звонки» — история звонков
   (#722); ключ `meetings` прежний, сменилась только подпись (#1074). */
type TListTab = 'chats' | 'channels' | 'groups' | 'meetings' | 'archive';

const LIST_TABS: { key: TListTab; fallback: string; hidden?: boolean }[] = [
  { key: 'chats', fallback: 'Чаты' },
  { key: 'channels', fallback: 'Каналы', hidden: true },
  { key: 'groups', fallback: 'Группы' },
  { key: 'meetings', fallback: 'Звонки' },
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
  const navigate = useNavigate();
  const setProfileRequest = useChatUiStore((state) => state.setProfileRequest);
  const tabsId = useId();
  const me = useProfileStore((state) => state.user);
  const [tab, setTab] = useState<TListTab>('chats');
  const panelRef = useRef<HTMLDivElement>(null);
  const connection = useConnectionStatus();

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
  // Найденный человек — начать с ним чат (#863: действие передаётся поиску).
  const startChat = useStartPrivateChat();
  const openSaved = useOpenSavedMessages();

  /* Архив живёт в том же кеше, что и основной список; запрос лёгкий. */
  const { data: archivedChats = [] } = useQuery(chatsQuery({ archived: true }));

  const renderRow = (chat: IChatDto) => (
    <ChatListItem
      chat={chat}
      currentUserId={me?.id}
      pinnedCount={pinnedCount}
      renderMenu={(props) => <ChatRowMenuWithActions {...props} />}
    />
  );

  const renderRows = (list: IChatDto[]) => (
    <VirtualChatList chats={list} renderRow={renderRow} scrollRef={panelRef} />
  );

  const selectTab = (value: TListTab) => {
    setTab(value);
    if (panelRef.current) panelRef.current.scrollTop = 0;
  };

  let content: ReactNode;
  if (search.isSearching) {
    /* Пока идёт поиск, список подменяется найденным — в любой вкладке:
       ищут человека или чат, а не раздел. Открытая переписка справа при
       этом остаётся на месте. */
    content = (
      <ChatsSearchResults
        chats={search.chats}
        isEmpty={search.isEmpty}
        isLoadingPeople={search.isLoadingPeople}
        isStartingChat={startChat.isPending}
        onStartChat={(userId) => startChat.mutate(userId)}
        people={search.people}
      />
    );
  } else if (tab === 'meetings') {
    content = (
      <CallHistoryList
        onOpenChat={(chatId) => navigate(ROUTES.CHAT_BY_ID(chatId))}
        // Профиль открывается там же и так же, как из шапки чата: чат и
        // его профиль поверх (#1074).
        onOpenProfile={(chatId, peerId) => {
          setProfileRequest({ chatId, userId: peerId });
          navigate(ROUTES.CHAT_BY_ID(chatId));
        }}
      />
    );
  } else if (isLoading) {
    content = <ChatListItemSkeleton />;
  } else if (error) {
    content = <ErrorChatListPlaceholder message={error} onRetry={() => void refetchChats()} />;
  } else if (tab === 'groups') {
    content = (
      <>
        {/* Новая группа — первой строкой своей вкладки: там её и ищут.
            Строка по размерам как строка чата, чтобы список не прыгал;
            цвет акцента говорит, что это действие, а не переписка. */}
        <button
          className="flex w-full shrink-0 items-center gap-3 rounded-bubble px-3 py-2.25 text-left text-brand transition-colors duration-fast hover:layer-hover active:layer-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2"
          onClick={onOpenCreateGroup}
          type="button"
        >
          <span
            aria-hidden="true"
            className="flex size-11.5 shrink-0 items-center justify-center rounded-pill bg-brand-soft"
          >
            <Icon name="groupAdd" size="md" />
          </span>
          <span className="text-body font-semibold">{t('newGroup', 'Новая группа')}</span>
        </button>

        {groups.length > 0 ? (
          renderRows(groups)
        ) : (
          <p className="px-5 py-8 text-center text-ui text-ink-3">
            {t('chatList.groupsEmpty', 'Групп пока нет')}
          </p>
        )}
      </>
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
    /* Закреплённые — просто первыми, без отдельного раздела: порядок
       держат сервер и chatsQuery, строку отмечает булавка. */
    content = visibleChats.length > 0 ? renderRows(visibleChats) : <EmptyChatListPlaceholder />;
  }

  /* Заголовок говорит и о связи (#819): пока её нет, «Сообщения» меняются
     на то, чего ждём, со спиннером. Объявляется вежливо — не перебивая. */
  const title =
    connection === 'offline'
      ? t('chatList.waitingForNetwork', 'Ожидание сети…')
      : connection === 'connecting'
        ? t('chatList.connecting', 'Соединение…')
        : t('chatList.title', 'Сообщения');

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-sheet">
      <header className="flex items-center gap-3 pt-[calc(18px+env(safe-area-inset-top,0px))] pr-4 pb-3.5 pl-5 md:pt-4.5">
        <Avatar
          id={me?.id}
          name={me?.firstName || me?.username}
          size="header"
          src={me?.avatarUrl}
        />
        <h1
          aria-live="polite"
          className="flex min-w-0 flex-1 items-center gap-2 text-section font-semibold tracking-[-0.01em]"
        >
          {connection !== 'connected' && <Spinner className="size-3.5 border-2" tone="current" />}
          <span className="truncate">{title}</span>
        </h1>
        {/* Вход в «Избранное» (#1075): себя в поиске людей не найти. */}
        <button
          aria-label={t('savedMessages.title', 'Избранное')}
          className={buttonStyles({
            variant: 'secondary',
            iconOnly: true,
            className: 'text-ink-2',
          })}
          disabled={openSaved.isPending}
          onClick={() => openSaved.mutate()}
          title={t('savedMessages.title', 'Избранное')}
          type="button"
        >
          <Icon name="bookmark" size="md" />
        </button>
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
          onChange={(value) => selectTab(value as TListTab)}
          options={VISIBLE_TABS.map(({ key, fallback }) => ({
            value: key,
            label: t(`chatList.tab.${key}`, fallback),
          }))}
          tabs={tabsId}
          value={tab}
        />
      </nav>

      <div className="px-4 pb-2.5">
        <ChatsSearchField onChange={search.setQuery} onReset={search.reset} value={search.query} />
      </div>

      {/* Новая версия приложения (#892) — важнее просьбы включить уведомления. */}
      <AppUpdateBanner />

      {/* «Включить уведомления» — пока не включили и не закрыли (#882). */}
      <PushPrompt />

      <div
        aria-busy={tab === 'meetings' ? false : isLoading}
        aria-labelledby={`${tabsId}-${tab}`}
        className="styled-scrollbar relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-[calc(8px+env(safe-area-inset-bottom,0px))]"
        id={`${tabsId}-panel`}
        ref={panelRef}
        role="tabpanel"
      >
        {content}
      </div>
    </div>
  );
}
