import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MIN_SEARCH_LENGTH,
  privacyExceptionsQuery,
  searchUsersQuery,
  useProfileStore,
  type TPrivacyExceptionMode,
  type TPrivacyRule,
} from '@/entities/user';
import { describeApiError } from '@/shared/api';
import { useDebounce } from '@/shared/lib';
import {
  Avatar,
  Banner,
  Icon,
  Input,
  ListGroup,
  ListItemButton,
  ListNavItem,
  ListStaticItem,
  showToast,
} from '@/shared/ui';
import { useRemovePrivacyException, useSetPrivacyException } from '../model/useExceptionActions';

interface Props {
  rule: TPrivacyRule;
  /** Какой список показать: при «Все» — «Никогда», при «Никто» — «Всегда». */
  mode: TPrivacyExceptionMode;
}

interface Person {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
}

const personName = (person: Person) =>
  [person.firstName, person.lastName].filter(Boolean).join(' ') || person.username;

/**
 * Список исключений одного правила (#786), как в Telegram: при «Все» —
 * кому всё же скрыть, при «Никто» — кому всё же открыть. Второй список при
 * этом выборе ничего бы не менял, поэтому не показывается; записи в нём
 * остаются и снова действуют, если правило переключить обратно.
 */
export function PrivacyExceptionsEditor({ rule, mode }: Props) {
  const { t } = useTranslation();
  const me = useProfileStore((state) => state.user?.id);
  const exceptions = useQuery(privacyExceptionsQuery());
  const setException = useSetPrivacyException();
  const removeException = useRemovePrivacyException();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const found = useQuery(searchUsersQuery(debounced));

  const listed = (exceptions.data ?? []).filter((item) => item.rule === rule && item.mode === mode);
  const listedIds = new Set(listed.map((item) => item.id));
  const candidates = ((found.data ?? []) as Person[]).filter(
    (person) => person.id !== me && !listedIds.has(person.id)
  );
  const searching = debounced.trim().replace(/^@/, '').length >= MIN_SEARCH_LENGTH;

  const fail = (fallback: string) => (error: unknown) =>
    showToast('error', describeApiError(error as { code?: string }, t, fallback));

  const title =
    mode === 'deny'
      ? t('privacyExceptions.never', 'Никогда не разрешать')
      : t('privacyExceptions.always', 'Всегда разрешать');
  const description =
    rule === 'calls'
      ? mode === 'deny'
        ? t(
            'privacyExceptions.callsNeverHint',
            'Этим людям запрещено звонить вам, даже если выбрано «Все».'
          )
        : t(
            'privacyExceptions.callsAlwaysHint',
            'Этим людям разрешено звонить вам, даже если выбрано «Никто».'
          )
      : mode === 'deny'
        ? t('privacyExceptions.neverHint', 'Этим людям — как при «Никто», хотя остальным открыто.')
        : t(
            'privacyExceptions.alwaysHint',
            'Этим людям — как при «Все», хотя от остальных скрыто.'
          );

  const avatar = (person: Person) => (
    <Avatar id={person.id} name={personName(person)} size="md" src={person.avatarUrl || null} />
  );

  /* Группа «Исключения» по макету (#828): люди из списка, под ними ряд
     «добавить» — он же раскрывается в поиск. */
  return (
    <>
      {exceptions.isError && (
        <Banner tone="danger">
          {t('privacyExceptions.loadError', 'Не удалось загрузить исключения.')}
        </Banner>
      )}

      <ListGroup
        note={
          <>
            {description}{' '}
            {rule === 'calls'
              ? t(
                  'privacyExceptions.callsBlockedWins',
                  'Чёрный список сильнее исключений: заблокированный пользователь не сможет позвонить вам, даже если он в «Всегда разрешать».'
                )
              : t(
                  'privacyExceptions.blockedWins',
                  'Чёрный список сильнее исключений: заблокированный не увидит ничего, даже если он в «Всегда разрешать».'
                )}
          </>
        }
        title={t('privacyExceptions.title', 'Исключения')}
      >
        {exceptions.isPending && <ListStaticItem label={t('loading', 'Загрузка...')} />}

        {listed.map((person) => (
          <ListStaticItem
            hint={`@${person.username}`}
            key={person.id}
            label={personName(person)}
            leading={avatar(person)}
            trailing={
              <button
                aria-label={t('privacyExceptions.remove', {
                  name: personName(person),
                  defaultValue: 'Убрать {{name}}',
                })}
                className="flex size-9 shrink-0 items-center justify-center rounded-icon text-ink-3 transition-colors duration-fast hover:layer-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
                disabled={removeException.isPending}
                onClick={() =>
                  removeException.mutate(
                    { rule, userId: person.id },
                    { onError: fail(t('privacyExceptions.removeFailed', 'Не удалось убрать')) }
                  )
                }
                type="button"
              >
                <Icon className="size-4.5 stroke-2" name="cross" />
              </button>
            }
          />
        ))}

        {adding ? (
          <div className="px-3 py-2.5">
            <Input
              aria-label={t('privacyExceptions.search', 'Найти человека')}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('privacyExceptions.search', 'Найти человека')}
              type="search"
              value={query}
            />
          </div>
        ) : (
          <ListNavItem
            icon="users"
            label={title}
            onClick={() => setAdding(true)}
            value={t('privacyExceptions.addShort', 'Добавить')}
          />
        )}

        {adding &&
          searching &&
          (found.isPending ? (
            <ListStaticItem label={t('loading', 'Загрузка...')} />
          ) : candidates.length > 0 ? (
            candidates.map((person) => (
              <ListStaticItem
                hint={`@${person.username}`}
                key={person.id}
                label={personName(person)}
                leading={avatar(person)}
                trailing={
                  <ListItemButton
                    ariaLabel={t('privacyExceptions.add', {
                      name: personName(person),
                      defaultValue: 'Добавить {{name}}',
                    })}
                    disabled={setException.isPending}
                    onClick={() =>
                      setException.mutate(
                        { rule, userId: person.id, mode },
                        {
                          onSuccess: () => {
                            setQuery('');
                            setAdding(false);
                          },
                          onError: fail(t('privacyExceptions.addFailed', 'Не удалось добавить')),
                        }
                      )
                    }
                  >
                    {t('privacyExceptions.addShort', 'Добавить')}
                  </ListItemButton>
                }
              />
            ))
          ) : (
            <ListStaticItem label={t('privacyExceptions.notFound', 'Никого не нашлось')} />
          ))}
      </ListGroup>
    </>
  );
}
