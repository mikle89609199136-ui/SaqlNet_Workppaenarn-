import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { blockedUsersQuery, type IBlockedUserDto } from '@/entities/user';
import { describeApiError } from '@/shared/api';
import { Avatar, Banner, Button, Icon, showToast } from '@/shared/ui';
import { useUnblockUser } from '../model/useBlockActions';

interface Props {
  onBack: () => void;
}

function displayName(user: IBlockedUserDto): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
}

/** Чёрный список в «Настройки → Конфиденциальность» (#727). */
export function BlockedUsersManager({ onBack }: Props) {
  const { t } = useTranslation();
  const blocked = useQuery(blockedUsersQuery());
  const unblock = useUnblockUser();
  const users = blocked.data ?? [];

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

      <header className="mb-4">
        <h1 className="mb-1 text-[21px] leading-tight font-semibold text-ink">
          {t('settings.privacy.blocked', 'Чёрный список')}
        </h1>
        <p className="text-caption text-ink-2">
          {t(
            'settings.privacy.blockedDescription',
            'Эти люди не могут писать вам и звонить. Заблокировать можно из профиля человека.'
          )}
        </p>
      </header>

      {blocked.isError && (
        <Banner tone="danger">
          {t(
            'settings.privacy.blockedError',
            'Не удалось загрузить чёрный список. Попробуйте обновить страницу.'
          )}
        </Banner>
      )}

      <div className="mt-4 divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
        {blocked.isPending ? (
          <div className="text-body p-5 text-center text-ink-2">{t('loading', 'Загрузка...')}</div>
        ) : users.length > 0 ? (
          users.map((user) => (
            <div className="flex items-center gap-3 p-4" key={user.id}>
              <Avatar
                id={user.id}
                name={displayName(user)}
                size="md"
                src={user.avatarUrl || null}
              />
              <div className="min-w-0">
                <strong className="text-body block truncate text-ink">{displayName(user)}</strong>
                <span className="text-caption block truncate text-ink-2">@{user.username}</span>
              </div>
              <Button
                className="ml-auto shrink-0"
                disabled={unblock.isPending && unblock.variables === user.id}
                onClick={() =>
                  unblock.mutate(user.id, {
                    onError: (error) =>
                      showToast(
                        'error',
                        describeApiError(
                          error as { code?: string },
                          t,
                          t('unblockFailed', 'Не удалось разблокировать')
                        )
                      ),
                  })
                }
                size="sm"
                variant="secondary"
              >
                {t('unblock', 'Разблокировать')}
              </Button>
            </div>
          ))
        ) : (
          <div className="text-body p-5 text-center text-ink-2">
            {blocked.isError
              ? t('settings.privacy.blockedUnavailable', 'Список недоступен')
              : t('settings.privacy.blockedEmpty', 'Вы никого не заблокировали')}
          </div>
        )}
      </div>
    </section>
  );
}
