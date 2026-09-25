import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar, Banner, Button, ConfirmDialog, Icon } from '@/shared/ui';
import { ROUTES, isAccountSubsection, type TAccountSubsection } from '@/shared/config/routes';
import { disconnectRealtimeSocket } from '@/shared/api';
import { meQuery, sessionsQuery } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { ProfileEditForm } from '@/features/user-profile-edit';
import { ChangePasswordForm } from '@/features/change-password';
import { SessionsManager } from '@/features/session-management';
import { KeyBackupSettings } from '@/features/key-backup';
import type { IUserDto } from '@/types';

/**
 * Раздел «Аккаунт»: обзор и подстраницы.
 *
 * Подстраница выбирается адресом (/settings/account/password), а не
 * состоянием — поэтому здесь только разбор параметра и переходы.
 */
export function AccountSection() {
  const { t } = useTranslation();
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
    if (view === 'profile') {
      return <ProfileEditForm onBack={() => openView('overview')} user={user} />;
    }

    if (view === 'password') {
      return <ChangePasswordForm onBack={() => openView('overview')} />;
    }

    if (view === 'email') {
      return <EmailSettings onBack={() => openView('overview')} user={user} />;
    }

    if (view === 'sessions') {
      return <SessionsManager onBack={() => openView('overview')} />;
    }

    if (view === 'encryption') {
      return <KeyBackupSettings onBack={() => openView('overview')} />;
    }

    return (
      <AccountSettings
        onEditProfile={() => openView('profile')}
        onLogout={() => setAsked(true)}
        onOpenEmail={() => openView('email')}
        onOpenEncryption={() => openView('encryption')}
        onOpenPassword={() => openView('password')}
        onOpenSessions={() => openView('sessions')}
        sessionsCount={sessions.data?.length}
        t={t}
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

interface OverviewRowProps {
  label: string;
  value?: ReactNode;
  onClick: () => void;
}

function OverviewRow({ label, value, onClick }: OverviewRowProps) {
  return (
    <button
      className="text-body flex min-h-[52px] w-full items-center justify-between gap-4 px-5 py-3 text-left text-ink transition-colors duration-fast hover:bg-sheet-2 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-2 text-ink-2">
        {value}
        <Icon className="text-ink-3" name="chevronRight" size="sm" />
      </span>
    </button>
  );
}

interface AccountSettingsProps {
  t: (key: string, fallback: string) => string;
  user: Partial<IUserDto>;
  sessionsCount?: number;
  onLogout: () => void;
  onEditProfile: () => void;
  onOpenEmail: () => void;
  onOpenPassword: () => void;
  onOpenSessions: () => void;
  onOpenEncryption: () => void;
}

function AccountSettings({
  t,
  user,
  sessionsCount,
  onLogout,
  onEditProfile,
  onOpenEmail,
  onOpenPassword,
  onOpenSessions,
  onOpenEncryption,
}: AccountSettingsProps) {
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Пользователь';

  return (
    <section>
      <h1 className="mb-5 text-[27px] leading-tight font-semibold text-ink">
        {t('settings.account.title', 'Аккаунт')}
      </h1>

      <div className="mb-7 flex items-center gap-4 rounded-bubble border border-line bg-sheet p-4">
        <Avatar
          id={user.id}
          name={user.firstName || user.username}
          size="xl"
          src={user.avatarUrl}
        />
        <div className="min-w-0">
          <strong className="text-body block truncate text-ink">{name}</strong>
          <span className="text-caption text-ink-2">
            {user.online ? 'в сети' : `@${user.username || 'user'}`}
          </span>
        </div>
        <Button className="ml-auto" onClick={onEditProfile} variant="secondary">
          {t('settings.account.editProfile', 'Изменить профиль')}
        </Button>
      </div>

      <h2 className="text-caption mb-3 font-semibold text-ink-2">
        {t('settings.account.groupSettings', 'Настройки аккаунта')}
      </h2>
      <div className="mb-7 divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
        <OverviewRow
          label={t('settings.account.email', 'Электронная почта')}
          onClick={onOpenEmail}
          value={user.email || t('settings.account.emailEmpty', 'не привязана')}
        />
        <OverviewRow
          label={t('settings.account.password', 'Пароль')}
          onClick={onOpenPassword}
          value="••••••••••"
        />
      </div>

      <h2 className="text-caption mb-3 font-semibold text-ink-2">
        {t('settings.account.groupActions', 'Действия')}
      </h2>
      <div className="divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
        <OverviewRow
          label={t('settings.account.sessions', 'Активные сеансы')}
          onClick={onOpenSessions}
          value={sessionsCount ?? '—'}
        />
        <OverviewRow
          label={t('keyBackup.settings.title', 'Шифрование и устройства')}
          onClick={onOpenEncryption}
        />
        <OverviewRow
          label={t('settings.account.logout', 'Выйти из аккаунта')}
          onClick={onLogout}
          value={<span className="text-danger">{t('settings.account.logoutAction', 'Выйти')}</span>}
        />
      </div>
    </section>
  );
}

function EmailSettings({ user, onBack }: { user: Partial<IUserDto>; onBack: () => void }) {
  const { t } = useTranslation();
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
          {t('settings.account.email', 'Электронная почта')}
        </h1>
        <p className="text-caption text-ink-2">
          {t('settings.email.description', 'Адрес для уведомлений и восстановления доступа.')}
        </p>
      </header>

      <Banner icon="info" tone="info">
        Привязка почты пока не работает: сервер её не сохраняет. Восстановить доступ по адресу
        нельзя — пароль держите под рукой.
      </Banner>

      <p className="text-body mt-4 text-ink-2">
        Текущий адрес: <span className="text-ink">{user.email || 'не привязан'}</span>
      </p>
    </section>
  );
}
