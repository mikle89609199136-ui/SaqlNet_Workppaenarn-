import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Banner, Button, Icon, Input, Spinner } from '@/shared/ui';
import { describeApiError } from '@/shared/api';
import { useBlockedUsers } from '../model/useBlockedUsers';
import { useUnblockUserMutation } from '../model/useUnblockUserMutation';

interface Props {
  onBack: () => void;
}

export function BlockedUsersList({ onBack }: Props) {
  const { t } = useTranslation();
  const { blockedUsers, isLoading, isError, error, refetch } = useBlockedUsers();
  const unblockMutation = useUnblockUserMutation();
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    if (!trimmedQuery) return blockedUsers;
    return blockedUsers.filter((user) => {
      const usernameMatch = user.username?.toLowerCase().includes(trimmedQuery);
      const firstNameMatch = user.firstName?.toLowerCase().includes(trimmedQuery);
      const lastNameMatch = user.lastName?.toLowerCase().includes(trimmedQuery);
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').toLowerCase();
      const fullNameMatch = fullName.includes(trimmedQuery);

      return usernameMatch || firstNameMatch || lastNameMatch || fullNameMatch;
    });
  }, [blockedUsers, trimmedQuery]);

  async function handleUnblock(userId: string) {
    setUnblockingId(userId);
    try {
      await unblockMutation.mutateAsync(userId);
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <section>
      <button
        className="text-caption -ml-2 mb-3 flex items-center gap-1 rounded-control px-2 py-1 text-ink-2 transition-colors duration-fast hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        onClick={onBack}
        type="button"
      >
        <Icon className="rotate-180" name="chevronRight" size="sm" />
        {t('back', 'Назад')}
      </button>

      <header className="mb-5">
        <h1 className="mb-1 text-[21px] leading-tight font-semibold text-ink">
          {t('settings.privacy.blockedUsers', 'Заблокированные пользователи')}
        </h1>
        <p className="text-caption text-ink-2">
          {t(
            'settings.privacy.blockedUsersDescription',
            'Пользователи в чёрном списке не могут писать вам и совершать звонки.'
          )}
        </p>
      </header>

      <div className="mb-4">
        <Input
          addon={
            searchQuery ? (
              <button
                aria-label={t('clearSearch', 'Очистить поиск')}
                className="cursor-pointer text-ink-3 transition-colors hover:text-ink"
                onClick={() => setSearchQuery('')}
                type="button"
              >
                <Icon name="cross" size="sm" />
              </button>
            ) : null
          }
          aria-label={t('settings.privacy.searchBlocked', 'Поиск по заблокированным...')}
          icon="search"
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t('settings.privacy.searchBlocked', 'Поиск по заблокированным...')}
          value={searchQuery}
        />
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-ink-2">
          <Spinner size="md" />
          <span className="text-body">{t('loading', 'Загрузка...')}</span>
        </div>
      )}

      {isError && (
        <Banner className="mb-4" kind="error">
          <div className="flex items-center justify-between gap-4">
            <span>
              {describeApiError(
                error as { code?: string; message?: string },
                t,
                t('errors.generic', 'Не получилось. Попробуйте ещё раз')
              )}
            </span>
            <Button onClick={() => refetch()} size="sm" variant="secondary">
              {t('retry', 'Повторить')}
            </Button>
          </div>
        </Banner>
      )}

      {!isLoading && !isError && blockedUsers.length === 0 && (
        <div className="rounded-bubble border border-line bg-sheet p-8 text-center shadow-[var(--elev-2)]">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-control bg-sheet-2 text-ink-2">
            <Icon name="user" size="md" />
          </div>
          <h2 className="text-body font-semibold text-ink">
            {t('settings.privacy.emptyBlocked', 'В чёрном списке пока никого нет')}
          </h2>
          <p className="text-caption mt-1 text-ink-2">
            {t(
              'settings.privacy.emptyBlockedDescription',
              'Здесь будут пользователи, которых вы заблокировали.'
            )}
          </p>
        </div>
      )}

      {!isLoading && !isError && blockedUsers.length > 0 && filteredUsers.length === 0 && (
        <div className="rounded-bubble border border-line bg-sheet p-8 text-center shadow-[var(--elev-2)]">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-control bg-sheet-2 text-ink-2">
            <Icon name="search" size="md" />
          </div>
          <h2 className="text-body font-semibold text-ink">
            {t('settings.privacy.noBlockedFound', 'Ничего не найдено')}
          </h2>
          <p className="text-caption mt-1 text-ink-2">
            {t(
              'settings.privacy.noBlockedFoundDescription',
              'По запросу «{{query}}» никто не найден.',
              { query: searchQuery.trim() }
            )}
          </p>
        </div>
      )}

      {!isLoading && !isError && filteredUsers.length > 0 && (
        <div className="rounded-bubble border border-line bg-sheet divide-y divide-line overflow-hidden shadow-[var(--elev-2)]">
          {filteredUsers.map((user) => {
            const name =
              [user.firstName, user.lastName].filter(Boolean).join(' ') ||
              user.username ||
              t('user', 'Пользователь');
            const isUnblocking = unblockingId === user.id && unblockMutation.isPending;

            return (
              <div
                key={user.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    id={user.id}
                    name={user.firstName || user.username}
                    size="md"
                    src={user.avatarUrl}
                  />
                  <div className="min-w-0">
                    <span className="text-body block truncate font-medium text-ink">
                      {name}
                    </span>
                    {user.username && (
                      <span className="text-caption block truncate text-ink-2">
                        @{user.username}
                      </span>
                    )}
                  </div>
                </div>

                <Button
                  disabled={isUnblocking}
                  loading={isUnblocking}
                  onClick={() => handleUnblock(user.id)}
                  size="sm"
                  variant="secondary"
                >
                  {t('settings.privacy.unblock', 'Разблокировать')}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
