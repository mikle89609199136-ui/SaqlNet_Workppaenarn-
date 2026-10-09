import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '@/shared/api';
import { buttonStyles, Spinner } from '@/shared/ui';
import { callHistoryInfiniteQuery, flattenCallHistory } from '../../model/callHistoryQuery';
import { CallHistoryItem } from './CallHistoryItem';
import { CallHistorySkeleton } from './CallHistorySkeleton';

export interface ICallHistoryListProps {
  onOpenChat: (chatId: string) => void;
}

export function CallHistoryList({ onOpenChat }: ICallHistoryListProps) {
  const { t } = useTranslation();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(callHistoryInfiniteQuery());

  const calls = useMemo(() => flattenCallHistory(data), [data]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (isLoading) {
    return <CallHistorySkeleton rows={8} />;
  }

  if (isError) {
    const errorMessage = describeApiError(
      error,
      t,
      t('call.history.error', 'Не удалось загрузить историю звонков')
    );

    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
        <p className="text-ui text-danger">{errorMessage}</p>
        <button
          className={buttonStyles({ variant: 'secondary', size: 'sm' })}
          onClick={() => void refetch()}
          type="button"
        >
          {t('call.history.retry', 'Повторить')}
        </button>
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-ui text-ink-3">
        {t('chatList.meetingsEmpty', 'Звонков пока нет')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5" data-testid="call-history-list">
      {calls.map((call) => (
        <CallHistoryItem
          item={call}
          key={call.id || call.roomId}
          onOpenChat={onOpenChat}
        />
      ))}

      {hasNextPage && (
        <div className="flex justify-center p-3" ref={sentinelRef}>
          {isFetchingNextPage ? (
            <Spinner size="sm" />
          ) : (
            <button
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              onClick={() => void fetchNextPage()}
              type="button"
            >
              {t('call.history.loadMore', 'Загрузить ещё')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
