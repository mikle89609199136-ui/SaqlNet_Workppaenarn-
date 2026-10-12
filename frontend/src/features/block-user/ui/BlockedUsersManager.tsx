import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { blockedUsersQuery, type IBlockedUserDto } from '@/entities/user';
import { describeApiError } from '@/shared/api';
import {
  Avatar,
  Banner,
  Input,
  ListGroup,
  ListItemButton,
  ListStaticItem,
  showToast,
} from '@/shared/ui';
import { useUnblockUser } from '../model/useBlockActions';

function displayName(user: IBlockedUserDto): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
}

/** Поиск по имени, фамилии и логину; «@» в начале не мешает. */
function matches(user: IBlockedUserDto, query: string): boolean {
  const needle = query.trim().replace(/^@/, '').toLowerCase();
  if (!needle) return true;
  return [user.firstName, user.lastName, user.username, displayName(user)].some((field) =>
    field?.toLowerCase().includes(needle)
  );
}

/** Чёрный список в «Настройки → Конфиденциальность» (#727). */
export function BlockedUsersManager() {
  const { t } = useTranslation();
  const blocked = useQuery(blockedUsersQuery());
  const unblock = useUnblockUser();
  const [query, setQuery] = useState('');
  const all = blocked.data ?? [];
  const users = all.filter((user) => matches(user, query));

  const unblockUser = (user: IBlockedUserDto) =>
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
    });

  /* Заголовок и «назад» — в шапке раздела настроек (#828). */
  return (
    <>
      {blocked.isError && (
        <Banner tone="danger">
          {t(
            'settings.privacy.blockedError',
            'Не удалось загрузить чёрный список. Попробуйте обновить страницу.'
          )}
        </Banner>
      )}

      {/* Поиск — когда есть в чём искать (идея из #761). */}
      {all.length > 0 && (
        <Input
          aria-label={t('settings.privacy.blockedSearch', 'Поиск в чёрном списке')}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('settings.privacy.blockedSearch', 'Поиск в чёрном списке')}
          type="search"
          value={query}
        />
      )}

      <ListGroup
        note={
          all.length > 0
            ? t(
                'settings.privacy.blockedNote',
                'Заблокированные не могут писать и звонить вам и не видят, когда вы в сети.'
              )
            : undefined
        }
      >
        {blocked.isPending ? (
          <ListStaticItem label={t('loading', 'Загрузка...')} />
        ) : users.length > 0 ? (
          users.map((user) => (
            <ListStaticItem
              hint={`@${user.username}`}
              key={user.id}
              label={displayName(user)}
              leading={
                <Avatar
                  id={user.id}
                  name={displayName(user)}
                  size="md"
                  src={user.avatarUrl || null}
                />
              }
              trailing={
                <ListItemButton
                  ariaLabel={t('settings.privacy.unblockUser', 'Разблокировать: {{name}}', {
                    name: displayName(user),
                  })}
                  disabled={unblock.isPending && unblock.variables === user.id}
                  onClick={() => unblockUser(user)}
                >
                  {t('unblock', 'Разблокировать')}
                </ListItemButton>
              }
            />
          ))
        ) : blocked.isError ? (
          <ListStaticItem label={t('settings.privacy.blockedUnavailable', 'Список недоступен')} />
        ) : all.length > 0 ? (
          <ListStaticItem label={t('settings.privacy.blockedNotFound', 'Никого не нашлось')} />
        ) : (
          <ListStaticItem
            hint={t(
              'settings.privacy.blockedEmptyHint',
              'Заблокировать человека можно из его профиля.'
            )}
            label={t('settings.privacy.blockedEmpty', 'Вы никого не заблокировали')}
          />
        )}
      </ListGroup>
    </>
  );
}
