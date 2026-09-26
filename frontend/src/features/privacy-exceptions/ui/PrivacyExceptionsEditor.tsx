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
import { Avatar, Banner, Button, Icon, Input, showToast } from '@/shared/ui';
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
    mode === 'deny'
      ? t('privacyExceptions.neverHint', 'Этим людям — как при «Никто», хотя остальным открыто.')
      : t('privacyExceptions.alwaysHint', 'Этим людям — как при «Все», хотя от остальных скрыто.');

  return (
    <section aria-label={title} className="mt-6">
      <h2 className="text-body mb-1 font-semibold text-ink">{title}</h2>
      <p className="text-caption mb-3 text-ink-2">{description}</p>

      {exceptions.isError && (
        <Banner tone="danger">
          {t('privacyExceptions.loadError', 'Не удалось загрузить исключения.')}
        </Banner>
      )}

      <div className="divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
        {exceptions.isPending ? (
          <div className="text-body p-4 text-center text-ink-2">{t('loading', 'Загрузка...')}</div>
        ) : listed.length > 0 ? (
          listed.map((person) => (
            <div className="flex items-center gap-3 px-4 py-3" key={person.id}>
              <Avatar
                id={person.id}
                name={personName(person)}
                size="sm"
                src={person.avatarUrl || null}
              />
              <div className="min-w-0">
                <strong className="text-body block truncate text-ink">{personName(person)}</strong>
                <span className="text-caption block truncate text-ink-2">@{person.username}</span>
              </div>
              <button
                aria-label={t('privacyExceptions.remove', {
                  name: personName(person),
                  defaultValue: 'Убрать {{name}}',
                })}
                className="ml-auto rounded-control p-1.5 text-ink-3 transition-colors duration-fast hover:bg-sheet-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
                disabled={removeException.isPending}
                onClick={() =>
                  removeException.mutate(
                    { rule, userId: person.id },
                    { onError: fail(t('privacyExceptions.removeFailed', 'Не удалось убрать')) }
                  )
                }
                type="button"
              >
                <Icon name="cross" size="sm" />
              </button>
            </div>
          ))
        ) : (
          <div className="text-caption p-4 text-center text-ink-2">
            {t('privacyExceptions.empty', 'Пока никого')}
          </div>
        )}
      </div>

      {adding ? (
        <div className="mt-3">
          <Input
            aria-label={t('privacyExceptions.search', 'Найти человека')}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('privacyExceptions.search', 'Найти человека')}
            type="search"
            value={query}
          />
          {searching && (
            <div className="mt-2 divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
              {found.isPending ? (
                <div className="text-caption p-3 text-center text-ink-2">
                  {t('loading', 'Загрузка...')}
                </div>
              ) : candidates.length > 0 ? (
                candidates.map((person) => (
                  <button
                    aria-label={t('privacyExceptions.add', {
                      name: personName(person),
                      defaultValue: 'Добавить {{name}}',
                    })}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-fast hover:bg-sheet-2 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
                    disabled={setException.isPending}
                    key={person.id}
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
                    type="button"
                  >
                    <Avatar
                      id={person.id}
                      name={personName(person)}
                      size="sm"
                      src={person.avatarUrl || null}
                    />
                    <span className="min-w-0">
                      <span className="text-body block truncate text-ink">
                        {personName(person)}
                      </span>
                      <span className="text-caption block truncate text-ink-2">
                        @{person.username}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="text-caption p-3 text-center text-ink-2">
                  {t('privacyExceptions.notFound', 'Никого не нашлось')}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <Button className="mt-3" onClick={() => setAdding(true)} size="sm" variant="secondary">
          {t('privacyExceptions.addPeople', 'Добавить людей')}
        </Button>
      )}

      <p className="text-caption mt-4 text-ink-3">
        {t(
          'privacyExceptions.blockedWins',
          'Чёрный список сильнее исключений: заблокированный не увидит ничего, даже если он в «Всегда разрешать».'
        )}
      </p>
    </section>
  );
}
