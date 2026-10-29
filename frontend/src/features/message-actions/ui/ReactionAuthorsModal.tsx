import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatUiStore, type IReactionAuthorsModalState } from '@/entities/chat';
import {
  useReactionAuthors,
  formatAuthorDisplayName,
  type IReaction,
  type IReactionAuthor,
} from '@/entities/message';
import { Modal } from '@/shared/ui/Modal';
import { Avatar } from '@/shared/ui/Avatar';
import { Icon } from '@/shared/ui/Icon';
import { NotoEmoji } from '@/shared/ui/NotoEmoji';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/shared/lib';

const EMPTY_REACTIONS: IReaction[] = [];

interface Props {
  currentUserId?: string;
  onSelectUser?: (userId: string) => void;
}

interface ContentProps {
  currentUserId?: string;
  modalState: IReactionAuthorsModalState;
  onClose: () => void;
  onSelectUser?: (userId: string) => void;
}

// Каждый emoji во вкладке «Все» имеет собственный серверный cursor.
function AllAuthorsGroup({
  messageId,
  emoji,
  renderRow,
}: {
  messageId: string;
  emoji: string;
  renderRow: (author: IReactionAuthor, emoji: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const query = useReactionAuthors({ messageId, emoji });
  return (
    <section aria-label={emoji} className="flex flex-col gap-1">
      {query.isLoading && <Skeleton className="h-12 rounded-field" />}
      {query.isError && (
        <div role="alert">
          {t('reactions.loadError', 'Не удалось загрузить авторов')}
          <button
            type="button"
            className="p-2 text-brand"
            onClick={() => {
              void query.refetch();
            }}
          >
            {t('reactions.retry', 'Повторить')}
          </button>
        </div>
      )}
      {!query.isLoading && !query.isError && query.authors.length === 0 && (
        <p>{t('reactions.noReactions', 'Никто ещё не поставил эту реакцию')}</p>
      )}
      {!query.isError && query.authors.map((author) => renderRow(author, emoji))}
      {query.hasNextPage && (
        <button
          type="button"
          aria-label={`${t('loadMore', 'Загрузить ещё')} ${emoji}`}
          className="p-2 text-brand"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t('loadMore', 'Загрузить ещё')} {emoji}
        </button>
      )}
    </section>
  );
}

function ReactionAuthorsModalContent({
  currentUserId,
  modalState,
  onClose,
  onSelectUser,
}: ContentProps) {
  const { t } = useTranslation();
  const setProfileRequest = useChatUiStore((state) => state.setProfileRequest);

  const reactions = modalState.reactions ?? EMPTY_REACTIONS;
  const messageId = modalState.messageId;

  const totalCount = useMemo(
    () => reactions.reduce((acc, item) => acc + item.count, 0),
    [reactions]
  );

  const initialTab =
    modalState.initialEmoji || (reactions.length > 1 ? 'all' : (reactions[0]?.emoji ?? 'all'));

  const [selectedTab, setActiveTab] = useState<string>(initialTab);
  const activeTab = reactions.some((reaction) => reaction.emoji === selectedTab)
    ? selectedTab
    : 'all';

  const isSpecificTab = activeTab !== 'all';

  const singleQuery = useReactionAuthors({
    messageId,
    emoji: isSpecificTab ? activeTab : (reactions[0]?.emoji ?? ''),
    enabled: isSpecificTab,
  });

  const isLoading = isSpecificTab && singleQuery.isLoading;

  const handleUserClick = (userId: string) => {
    if (onSelectUser) {
      onSelectUser(userId);
    } else if (modalState.chatId) {
      setProfileRequest({ chatId: modalState.chatId, userId });
    }
    onClose();
  };

  const renderAuthorRow = (author: IReactionAuthor, emoji: string) => {
    const isMe = author.id === currentUserId;
    const displayName = formatAuthorDisplayName(author);

    return (
      <div
        key={`${author.id}-${emoji}`}
        role="button"
        tabIndex={0}
        onClick={() => handleUserClick(author.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleUserClick(author.id);
          }
        }}
        className="group flex items-center justify-between p-2 rounded-field cursor-pointer transition-colors hover:layer-hover active:layer-press focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Avatar id={author.id} name={displayName} src={author.avatarUrl} size="md" />
          <div className="min-w-0">
            <div className="text-body font-medium text-ink truncate group-hover:text-brand transition-colors">
              {displayName}
              {isMe && (
                <span className="ml-1.5 text-caption font-normal text-ink-3">
                  ({t('reactions.you', 'Вы')})
                </span>
              )}
            </div>
            {author.username && (
              <div className="text-caption text-ink-3 truncate">@{author.username}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <NotoEmoji emoji={emoji} size={20} />
          <Icon
            name="chevronRight"
            className="size-4 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity max-md:hidden"
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {reactions.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-divider pb-2.5 overflow-x-auto scrollbar-none">
          <button
            type="button"
            aria-pressed={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-caption font-semibold transition-colors cursor-pointer',
              activeTab === 'all'
                ? 'bg-brand-fill text-on-brand'
                : 'bg-sheet-2 text-ink-2 hover:layer-hover'
            )}
          >
            <span>{t('reactions.tabAll', 'Все')}</span>
            <span className={activeTab === 'all' ? 'text-on-brand' : 'text-ink-3'}>
              {totalCount}
            </span>
          </button>
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              aria-label={`${r.emoji} ${r.count}`}
              aria-pressed={activeTab === r.emoji}
              onClick={() => setActiveTab(r.emoji)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-caption font-semibold transition-colors cursor-pointer',
                activeTab === r.emoji
                  ? 'bg-brand-fill text-on-brand'
                  : 'bg-sheet-2 text-ink-2 hover:layer-hover'
              )}
            >
              <NotoEmoji emoji={r.emoji} size={18} />
              <span className={activeTab === r.emoji ? 'text-on-brand' : 'text-ink-2'}>
                {r.count}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        className="min-h-[280px] max-h-[360px] overflow-y-auto styled-scrollbar flex flex-col gap-1 pr-1"
        data-testid="reaction-authors-list"
      >
        {isLoading && (
          <div className="flex flex-col gap-2 py-2" data-testid="reaction-authors-skeleton">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="size-10 rounded-pill shrink-0" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <Skeleton className="h-4 w-32 rounded-field" />
                  <Skeleton className="h-3 w-20 rounded-field" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading &&
          isSpecificTab &&
          !singleQuery.isError &&
          singleQuery.authors.length === 0 && (
            <div className="flex flex-1 items-center justify-center py-8 text-center text-caption text-ink-3">
              {t('reactions.noReactions', 'Никто ещё не поставил эту реакцию')}
            </div>
          )}

        {isSpecificTab && singleQuery.isError && (
          <div role="alert">
            {t('reactions.loadError', 'Не удалось загрузить авторов')}
            <button
              type="button"
              className="p-2 text-brand"
              onClick={() => {
                void singleQuery.refetch();
              }}
            >
              {t('reactions.retry', 'Повторить')}
            </button>
          </div>
        )}
        {!isLoading &&
          isSpecificTab &&
          !singleQuery.isError &&
          singleQuery.authors.map((author) => renderAuthorRow(author, activeTab))}
        {!isSpecificTab && reactions.length === 0 && (
          <p>{t('reactions.noReactions', 'Никто ещё не поставил эту реакцию')}</p>
        )}
        {!isSpecificTab &&
          reactions.map((reaction) => (
            <AllAuthorsGroup
              key={reaction.emoji}
              messageId={messageId}
              emoji={reaction.emoji}
              renderRow={renderAuthorRow}
            />
          ))}

        {isSpecificTab && singleQuery.hasNextPage && (
          <button
            type="button"
            disabled={singleQuery.isFetchingNextPage}
            onClick={() => singleQuery.fetchNextPage()}
            className="mt-2 text-caption text-brand hover:underline p-2 text-center"
          >
            {singleQuery.isFetchingNextPage
              ? t('loading', 'Загрузка...')
              : t('loadMore', 'Загрузить ещё')}
          </button>
        )}
      </div>
    </div>
  );
}

export function ReactionAuthorsModal({ currentUserId, onSelectUser }: Props) {
  const { t } = useTranslation();
  const modalState = useChatUiStore((state) => state.reactionAuthorsModal);
  const setReactionAuthorsModal = useChatUiStore((state) => state.setReactionAuthorsModal);

  const isOpen = Boolean(modalState);
  const handleClose = () => setReactionAuthorsModal(null);

  if (!isOpen || !modalState) return null;

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title={t('reactions.title', 'Реакции')}
      className="max-w-md w-full"
    >
      <ReactionAuthorsModalContent
        key={`${modalState.messageId}-${modalState.initialEmoji ?? 'all'}`}
        currentUserId={currentUserId}
        modalState={modalState}
        onClose={handleClose}
        onSelectUser={onSelectUser}
      />
    </Modal>
  );
}
