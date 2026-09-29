import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Banner, ConfirmDialog } from '@/shared/ui';
import { ROUTES, isAccountSubsection, type TAccountSubsection } from '@/shared/config/routes';
import { disconnectRealtimeSocket } from '@/shared/api';
import { meQuery, sessionsQuery } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { ProfileEditForm } from '@/features/user-profile-edit';
import { ChangePasswordForm } from '@/features/change-password';
import { SessionsManager } from '@/features/session-management';
import { KeyBackupSettings } from '@/features/key-backup';
import { LinkDevicePanel, QrOfferPanel } from '@/features/qr-login';
import { UserProfilePanel } from '@/features/user-profile';
import type { IUserDto } from '@/types';
import { ListGroup, ListIntro, ListNavItem, ListStaticItem } from '@/shared/ui';

/**
 * Раздел «Аккаунт»: обзор и подстраницы.
 *
 * Подстраница выбирается адресом (/settings/account/password), а не
 * состоянием — поэтому здесь только разбор параметра и переходы.
 */
export function AccountSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ subsection: string }>();
  const { data: user = {}, isPending } = useQuery(meQuery());

  const view = isAccountSubsection(params.subsection) ? params.subsection : 'overview';

  const sessions = useQuery(sessionsQuery());
  const [asked, setAsked] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const openView = (next: TAccountSubsection | 'overview') =>
    navigate(
      next === 'overview'
        ? ROUTES.SETTINGS_SECTION('account')
        : ROUTES.SETTINGS_SUBSECTION('account', next)
    );

  async function handleLogout() {
    setLeaving(true);
    try {
      await services.authService.logout().catch(() => {});
      disconnectRealtimeSocket();

      /* Запрет из docs/frontend-data-architecture.md: без этого после
         входа другим пользователем в той же вкладке в памяти остаются
         чужие сообщения — расшифрованные. */
      queryClient.clear();

      navigate('/login');
    } finally {
      setLeaving(false);
      setAsked(false);
    }
  }

  if (isPending) return <div className="text-body py-16 text-center text-ink-2">Загрузка…</div>;

  function renderView() {
    if (view === 'me') {
      return <MyProfile onEdit={() => openView('profile')} userId={user.id} />;
    }

    if (view === 'profile') {
      return <ProfileEditForm onBack={() => openView('overview')} user={user} />;
    }

    if (view === 'password') {
      return <ChangePasswordForm onBack={() => openView('overview')} />;
    }

    if (view === 'email') {
      return <EmailSettings user={user} />;
    }

    if (view === 'sessions') {
      return <SessionsManager />;
    }

    if (view === 'encryption') {
      return (
        <KeyBackupSettings
          renderLinkDevice={(onDone) => <LinkDevicePanel onDone={onDone} />}
          renderLoginCode={(onDone) => <QrOfferPanel onDone={onDone} />}
        />
      );
    }

    return (
      <AccountSettings
        onLogout={() => setAsked(true)}
        sessionsCount={sessions.data?.length}
        user={user}
      />
    );
  }

  return (
    <>
      {renderView()}

      <ConfirmDialog
        confirmLabel="Выйти"
        confirming={leaving}
        danger={false}
        onCancel={() => setAsked(false)}
        onConfirm={handleLogout}
        open={asked}
        title="Выйти из аккаунта?"
      >
        Переписка останется на этом устройстве и откроется после следующего входа.
      </ConfirmDialog>
    </>
  );
}

interface AccountSettingsProps {
  user: Partial<IUserDto>;
  sessionsCount?: number;
  onLogout: () => void;
}

/** Обзор аккаунта — по макету (#828). */
function AccountSettings({ user, sessionsCount, onLogout }: AccountSettingsProps) {
  const { t } = useTranslation();
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Пользователь';
  const sub = (subsection: TAccountSubsection) => ROUTES.SETTINGS_SUBSECTION('account', subsection);

  return (
    <>
      {/* Карточка профиля: нажатие открывает профиль так, как его видят
          другие; «Изменить» — сразу форма. */}
      <div className="flex items-center gap-4 rounded-dialog bg-card p-4.5">
        <Link
          aria-label={t('settings.me.open', 'Открыть мой профиль')}
          className="flex min-w-0 grow items-center gap-4 rounded-field focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          to={sub('me')}
        >
          <Avatar
            id={user.id}
            name={user.firstName || user.username}
            size="card"
            src={user.avatarUrl}
          />
          <span className="flex min-w-0 flex-col gap-0.75">
            <span className="truncate text-section font-semibold text-ink">{name}</span>
            {user.username && <span className="text-ui text-ink-3">@{user.username}</span>}
          </span>
        </Link>
        <Link
          className="flex h-9.5 shrink-0 items-center rounded-icon bg-brand-soft px-3.5 text-ui font-semibold text-brand hover:layer-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          to={sub('profile')}
        >
          {t('settings.account.edit', 'Изменить')}
        </Link>
      </div>

      <ListGroup title={t('settings.account.groupSettings', 'Настройки аккаунта')}>
        <ListNavItem
          icon="mail"
          label={t('settings.account.email', 'Электронная почта')}
          to={sub('email')}
          value={user.email || t('settings.account.emailEmpty', 'не привязана')}
        />
        <ListNavItem
          icon="key"
          label={t('settings.account.password', 'Пароль')}
          to={sub('password')}
        />
      </ListGroup>

      <ListGroup title={t('settings.account.groupSecurity', 'Безопасность')}>
        <ListNavItem
          icon="devices"
          label={t('settings.account.sessions', 'Активные сеансы')}
          to={sub('sessions')}
          value={sessionsCount || undefined}
        />
        <ListNavItem
          hint={t('settings.account.encryptionHint', 'Облачный пароль, passkey, вход по QR-коду')}
          icon="shield"
          label={t('keyBackup.settings.title', 'Шифрование и устройства')}
          to={sub('encryption')}
        />
      </ListGroup>

      <ListGroup>
        <ListNavItem
          icon="logOut"
          label={t('settings.account.logout', 'Выйти из аккаунта')}
          onClick={onLogout}
          tone="danger"
        />
      </ListGroup>
    </>
  );
}

/**
 * «Мой профиль» — так, как его видят другие (#828): та же панель, что у
 * чужого профиля. «Изменить» ведёт в форму профиля.
 */
function MyProfile({ userId, onEdit }: { userId?: string; onEdit: () => void }) {
  if (!userId) return null;
  return (
    <div className="overflow-hidden rounded-dialog bg-card [&>aside]:bg-card">
      <UserProfilePanel
        bar={false}
        onClose={onEdit}
        onEdit={onEdit}
        profileState={{ isOpen: true, userId, chat: null, messages: [] }}
      />
    </div>
  );
}

function EmailSettings({ user }: { user: Partial<IUserDto> }) {
  const { t } = useTranslation();
  return (
    <>
      <ListIntro>
        {t('settings.email.description', 'Адрес для уведомлений и восстановления доступа.')}
      </ListIntro>

      <Banner icon="info" tone="info">
        Привязка почты пока не работает: сервер её не сохраняет. Восстановить доступ по адресу
        нельзя — пароль держите под рукой.
      </Banner>

      <ListGroup>
        <ListStaticItem
          icon="mail"
          label={t('settings.email.current', 'Текущий адрес')}
          trailing={
            <span className="shrink-0 text-ui text-ink-3">
              {user.email || t('settings.account.emailEmpty', 'не привязана')}
            </span>
          }
        />
      </ListGroup>
    </>
  );
}
