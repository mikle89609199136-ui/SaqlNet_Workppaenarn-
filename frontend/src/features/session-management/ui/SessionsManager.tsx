import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Button,
  ConfirmDialog,
  ListGroup,
  ListIntro,
  ListItemButton,
  ListNavItem,
  ListStaticItem,
} from '@/shared/ui';
import { sessionsQuery } from '@/entities/user';
import {
  useSessionActions,
  type TAuthSession,
  type TSessionNotice,
} from '../model/useSessionActions';

interface Props {
  /** Auth cleanup is supplied by the page: one feature does not import another. */
  onSignedOut: () => void;
}

export function SessionsManager({ onSignedOut }: Props) {
  const { t, i18n } = useTranslation();
  const sessions = useQuery(sessionsQuery());
  const actions = useSessionActions(onSignedOut);
  const sessionList = sessions.data ?? [];
  const current = sessionList.find((session) => session.isCurrent === true);
  const others = sessionList.filter((session) => session.isCurrent === false);
  const unknown = sessionList.filter((session) => typeof session.isCurrent !== 'boolean');
  const deviceName = (session: TAuthSession) =>
    session.deviceName || t('settings.sessions.device', 'Устройство');
  const deviceTypeLabel = (type: string) => {
    if (type === 'desktop') return t('settings.sessions.type.desktop', 'компьютер');
    if (type === 'mobile') return t('settings.sessions.type.mobile', 'телефон');
    if (type === 'tablet') return t('settings.sessions.type.tablet', 'планшет');
    return t('settings.sessions.type.unknown', 'неизвестно');
  };
  const formatDate = (value?: string | number) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? date.toLocaleString(i18n.language)
      : t('settings.sessions.noData', 'нет данных');
  };
  const sessionItem = (session: TAuthSession) => {
    const metadata = [session.ipAddress, session.location].filter(
      (value) => value && value.toLowerCase() !== 'unknown'
    );
    return (
      <ListStaticItem
        hint={
          <>
            {deviceTypeLabel(session.deviceType)} ·{' '}
            {t('settings.sessions.lastActive', 'Последняя активность')}:{' '}
            {formatDate(session.lastActive)}
            {metadata.length > 0 && <span className="block">{metadata.join(' · ')}</span>}
          </>
        }
        icon={session.deviceType === 'mobile' ? 'smartphone' : 'laptop'}
        key={session.id}
        label={<span className="break-words">{deviceName(session)}</span>}
        trailing={
          session.isCurrent === false && (
            <ListItemButton
              danger
              disabled={actions.busy}
              ariaLabel={t('settings.sessions.endNamed', {
                name: deviceName(session),
                defaultValue: 'Завершить сеанс: {{name}}',
              })}
              onClick={() => actions.ask({ kind: 'one', target: session })}
            >
              {t('settings.sessions.endOne', 'Завершить')}
            </ListItemButton>
          )
        }
      />
    );
  };
  const refreshButton = (
    <Button
      size="sm"
      variant="ghost"
      disabled={actions.busy || sessions.isFetching}
      onClick={async () => {
        const result = await sessions.refetch();
        if (!result.isError) actions.clearNotice();
      }}
    >
      {t('settings.sessions.refresh', 'Обновить')}
    </Button>
  );
  const notices: Record<TSessionNotice, string> = {
    gone: t('settings.sessions.alreadyEnded', 'Этот сеанс уже завершён или больше недоступен.'),
    current: t(
      'settings.sessions.cannotEndCurrent',
      'Это текущий сеанс. Для выхода используйте «Выйти из аккаунта» в разделе «Аккаунт».'
    ),
    failed: t(
      'settings.sessions.revokeFailed',
      'Не удалось завершить выбранные сеансы. Проверьте соединение и повторите попытку.'
    ),
    allFailed: t(
      'settings.sessions.terminateFailed',
      'Не удалось завершить сеансы. Другие устройства всё ещё могут иметь доступ к аккаунту; повторите попытку позже.'
    ),
    refreshFailed: t(
      'settings.sessions.refreshFailed',
      'Сеансы завершены, но обновить список не удалось. Повторите загрузку списка.'
    ),
  };
  const intent = actions.asked;
  const one = intent?.kind === 'one';
  const othersAsked = intent?.kind === 'others';
  const title = one
    ? t('settings.sessions.oneTitle', {
        name: deviceName(intent.target),
        defaultValue: 'Завершить сеанс «{{name}}»?',
      })
    : othersAsked
      ? t('settings.sessions.othersTitle', 'Завершить все остальные сеансы?')
      : t('settings.sessions.terminateTitle', 'Завершить все сеансы?');

  return (
    <>
      <ListIntro>
        {t('settings.sessions.description', 'Устройства, на которых выполнен вход в аккаунт.')}
      </ListIntro>
      {sessions.isError && actions.notice !== 'refreshFailed' && (
        <Banner tone="danger" action={refreshButton}>
          {t(
            'settings.sessions.loadFailed',
            'Не удалось получить список устройств. Это не значит, что их нет, — попробуйте обновить список.'
          )}
        </Banner>
      )}
      {actions.notice && (
        <Banner
          tone={
            actions.notice === 'gone'
              ? 'info'
              : actions.notice === 'current' || actions.notice === 'refreshFailed'
                ? 'warn'
                : 'danger'
          }
          action={actions.notice === 'refreshFailed' ? refreshButton : undefined}
        >
          {notices[actions.notice]}
        </Banner>
      )}
      {!sessions.isPending && !sessions.isError && sessionList.length === 0 && (
        <Banner icon="shield" tone="warn">
          {t(
            'settings.sessions.noneFound',
            'Активные сеансы не найдены. Это возможно для входа, выполненного до обновления учёта устройств; при необходимости завершите все сеансы кнопкой ниже.'
          )}
        </Banner>
      )}
      {!sessions.isPending && !sessions.isError && sessionList.length > 0 && !current && (
        <Banner icon="shield" tone="warn">
          {t(
            'settings.sessions.currentMissing',
            'Текущее устройство было авторизовано до обновления учёта сеансов и пока не отображается в списке.'
          )}
        </Banner>
      )}
      <fieldset
        className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0"
        disabled={actions.busy}
        aria-busy={actions.busy}
      >
        <legend className="sr-only">
          {t('settings.sessions.description', 'Устройства, на которых выполнен вход в аккаунт.')}
        </legend>
        {sessions.isPending ? (
          <ListGroup>
            <ListStaticItem label={t('loading', 'Загрузка...')} />
          </ListGroup>
        ) : (
          <>
            {current && (
              <ListGroup
                title={t('settings.sessions.current', 'Это устройство')}
                note={t(
                  'settings.sessions.currentNote',
                  'Чтобы выйти на этом устройстве, используйте «Выйти из аккаунта» в разделе «Аккаунт».'
                )}
              >
                {sessionItem(current)}
              </ListGroup>
            )}
            {others.length > 0 && (
              <ListGroup title={t('settings.sessions.others', 'Другие сеансы')}>
                {others.map(sessionItem)}
              </ListGroup>
            )}
            {unknown.length > 0 && (
              <ListGroup title={t('settings.sessions.unverified', 'Неопределённые сеансы')}>
                {unknown.map(sessionItem)}
              </ListGroup>
            )}
            {sessions.isSuccess && current && others.length === 0 && unknown.length === 0 && (
              <Banner>{t('settings.sessions.noOthers', 'Других активных сеансов нет.')}</Banner>
            )}
          </>
        )}
        {others.length > 0 && (
          <ListGroup
            note={t(
              'settings.sessions.othersNote',
              'Это устройство продолжит работу. Локальные ключи шифрования сохранятся.'
            )}
          >
            <ListNavItem
              icon="logOut"
              label={t('settings.sessions.endOthers', 'Завершить все, кроме этого')}
              onClick={() => actions.ask({ kind: 'others' })}
              tone="danger"
            />
          </ListGroup>
        )}
        <ListGroup
          note={t(
            'settings.sessions.terminateNote',
            'Выход произойдёт на всех устройствах, включая это.'
          )}
        >
          <ListNavItem
            icon="logOut"
            label={t('settings.sessions.terminate', 'Завершить все сеансы')}
            onClick={() => actions.ask({ kind: 'all' })}
            tone="danger"
          />
        </ListGroup>
      </fieldset>
      <ConfirmDialog
        confirmLabel={
          one
            ? t('settings.sessions.endOneConfirm', 'Завершить сеанс')
            : othersAsked
              ? t('settings.sessions.endOthersConfirm', 'Завершить остальные')
              : t('settings.sessions.terminateConfirm', 'Завершить сеансы')
        }
        confirming={actions.busy}
        cancelDisabled={actions.busy}
        danger
        onCancel={actions.cancel}
        onConfirm={actions.confirm}
        open={intent !== null}
        title={title}
      >
        {one
          ? t(
              'settings.sessions.oneText',
              'На выбранном устройстве потребуется снова войти. Текущий сеанс продолжит работу, локальные ключи шифрования сохранятся.'
            )
          : othersAsked
            ? t(
                'settings.sessions.othersText',
                'На остальных устройствах потребуется снова войти. Это устройство продолжит работу, локальные ключи шифрования сохранятся.'
              )
            : t(
                'settings.sessions.terminateText',
                'Выход произойдёт на всех устройствах, а ключи шифрования с этого будут удалены. Переписка сохранена в резервной копии: после входа откройте её облачным паролем.'
              )}
      </ConfirmDialog>
    </>
  );
}
