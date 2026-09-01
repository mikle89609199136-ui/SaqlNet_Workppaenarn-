import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar, Banner, ConfirmDialog } from '@/components/ui';
import { ROUTES, isAccountSubsection, type TAccountSubsection } from '@/consts/routes';
import { disconnectRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { useToasts } from '@/hooks/useToasts';
import { userKeys } from '@/queries/keys';
import { meQuery } from '@/queries/users/meQuery';
import { sessionsQuery, twoFAStatusQuery } from '@/queries/users/securityQueries';
import { services } from '@/services/serviceContainer';
import { useProfileStore } from '@/store';
import { Field } from '../SettingsControls';

/**
 * Раздел «Аккаунт»: обзор и подстраницы.
 *
 * Подстраница выбирается адресом (/settings/account/password), а не
 * состоянием — поэтому здесь только разбор параметра и переходы.
 *
 * Разметка и формы перенесены из прежней общей страницы без изменений:
 * их переписывание — отдельная работа (#473), и смешивать её с переездом
 * значило бы получить диff, в котором не видно ни того, ни другого.
 */
export function AccountSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToasts();
  const params = useParams<{ subsection: string }>();
  const { data: user = {}, isPending } = useQuery(meQuery());

  const view = isAccountSubsection(params.subsection) ? params.subsection : 'overview';

  /* Статус второй ступени и список устройств спрашиваются у сервера.
     Прежде они брались из useState — «отключена» и «сеансов нет»
     независимо от действительности (#478). */
  const twoFA = useQuery(twoFAStatusQuery());
  const sessions = useQuery(sessionsQuery());
  const [saving, setSaving] = useState(false);
  /* Какое действие ждёт подтверждения. Оба уводят из аккаунта, но одно из
     них вдобавок стирает ключи, поэтому спрашиваются они по-разному. */
  const [asked, setAsked] = useState<'logout' | 'logoutAll' | null>(null);
  const [leaving, setLeaving] = useState(false);

  const openView = (next: TAccountSubsection | 'overview') =>
    navigate(
      next === 'overview'
        ? ROUTES.SETTINGS_SECTION('account')
        : ROUTES.SETTINGS_SUBSECTION('account', next)
    );

  /**
   * Профиль изменил сам пользователь — обновляем оба его представления.
   *
   * Профиль задублирован кешем и стором, и стор читают 65 мест: расселение
   * этой пары — отдельная работа (#241), а не попутная правка.
   */
  function handleUserChange(next: any) {
    queryClient.setQueryData(userKeys.me(), next);
    useProfileStore.getState().setUser(next);
  }

  async function logout(all = false) {
    setLeaving(true);
    try {
      if (all) await services.authService.logoutAll().catch(() => {});
      else await services.authService.logout().catch(() => {});

      // Завершение всех сеансов стирает и ключи шифрования: это тот самый
      // случай, ради которого кнопку нажимают — чужой или потерянный
      // компьютер. Обычный выход ключи оставляет.
      if (all) await services.cryptoService.wipeDevice().catch(() => {});

      disconnectRealtimeSocket();

      /* Запрет из docs/frontend-data-architecture.md: без этого после
         входа другим пользователем в той же вкладке в памяти остаются
         чужие сообщения — расшифрованные. */
      queryClient.clear();

      navigate('/login');
    } finally {
      setLeaving(false);
      setAsked(null);
    }
  }

  if (isPending) return <div className="settings-detail-state">Загрузка…</div>;

  /* Подстраница выбирается функцией, а не ранними возвратами из раздела:
     окно подтверждения общее, и при выходе по return его бы просто не
     оказалось в разметке. */
  function renderView() {
    if (view === 'profile') {
      return (
        <ProfileSettings
          onBack={() => openView('overview')}
          onUserChange={handleUserChange}
          saving={saving}
          setSaving={setSaving}
          showToast={showToast}
          user={user}
        />
      );
    }

    if (view === 'password') {
      return (
        <PasswordSettings
          onBack={() => openView('overview')}
          saving={saving}
          setSaving={setSaving}
          showToast={showToast}
        />
      );
    }

    if (view === 'email') {
      return (
        <EmailSettings onBack={() => openView('overview')} showToast={showToast} user={user} />
      );
    }

    if (view === 'twoFA') {
      return (
        <TwoFASettings
          enabled={twoFA.data}
          loading={twoFA.isPending}
          onBack={() => openView('overview')}
          onEnabledChange={() => void twoFA.refetch()}
          saving={saving}
          setSaving={setSaving}
          showToast={showToast}
        />
      );
    }

    if (view === 'sessions') {
      return (
        <SessionsSettings
          error={sessions.isError}
          loading={sessions.isPending}
          onBack={() => openView('overview')}
          onLogoutAll={() => setAsked('logoutAll')}
          sessions={sessions.data ?? []}
        />
      );
    }

    return (
      <AccountSettings
        onEditProfile={() => openView('profile')}
        onLogout={() => setAsked('logout')}
        onOpenEmail={() => openView('email')}
        onOpenPassword={() => openView('password')}
        onOpenSessions={() => openView('sessions')}
        onOpenTwoFA={() => openView('twoFA')}
        sessionsCount={sessions.data?.length}
        twoFAEnabled={twoFA.data}
        user={user}
      />
    );
  }

  const confirmations = {
    logout: {
      title: 'Выйти из аккаунта?',
      confirmLabel: 'Выйти',
      danger: false,
      text: 'Переписка останется на этом устройстве и откроется после следующего входа.',
    },
    logoutAll: {
      title: 'Завершить все сеансы?',
      confirmLabel: 'Завершить сеансы',
      danger: true,
      text: 'Выход произойдёт на всех устройствах, а ключи шифрования с этого будут удалены. Прошлая переписка здесь больше не откроется — восстановить её нечем.',
    },
  } as const;

  const confirmation = asked ? confirmations[asked] : null;

  return (
    <>
      {renderView()}

      {confirmation && (
        <ConfirmDialog
          confirmLabel={confirmation.confirmLabel}
          confirming={leaving}
          danger={confirmation.danger}
          onCancel={() => setAsked(null)}
          onConfirm={() => void logout(asked === 'logoutAll')}
          open
          title={confirmation.title}
        >
          {confirmation.text}
        </ConfirmDialog>
      )}
    </>
  );
}

function AccountSettings({
  user,
  sessionsCount,
  twoFAEnabled,
  onLogout,
  onEditProfile,
  onOpenEmail,
  onOpenPassword,
  onOpenTwoFA,
  onOpenSessions,
}) {
  return (
    <>
      <section className="settings-account-overview">
        <h1>Аккаунт</h1>
        <div className="settings-account-summary settings-overview-profile">
          <Avatar
            id={user.id}
            name={user.firstName || user.username}
            size="xl"
            src={user.avatarUrl}
          />
          <div className="settings-account-identity">
            <strong>
              {[user.firstName, user.lastName].filter(Boolean).join(' ') ||
                user.username ||
                'Пользователь'}
            </strong>
            <span>{user.online ? 'в сети' : `@${user.username || 'user'}`}</span>
          </div>
          <button type="button" className="settings-edit-profile" onClick={onEditProfile}>
            Изменить профиль
          </button>
        </div>
        <h2>Настройки аккаунта</h2>
        <div className="settings-overview-group">
          <button type="button" onClick={onOpenEmail}>
            <span>Электронная почта</span>
            <span>
              {user.email || 'не привязана'}
              <b>›</b>
            </span>
          </button>
          <button type="button" onClick={onOpenPassword}>
            <span>Пароль</span>
            <span>
              •••••••••• <b>›</b>
            </span>
          </button>
          <button type="button" onClick={onOpenTwoFA}>
            <span>Двухфакторная аутентификация</span>
            {/* Пока ответ не пришёл — прочерк, а не «отключена»: в разделе
                безопасности выдуманное значение хуже отсутствия ответа. */}
            <span>
              {twoFAEnabled === undefined ? '—' : twoFAEnabled ? 'включена' : 'отключена'}
              <b>›</b>
            </span>
          </button>
        </div>
        <h2>Действия</h2>
        <div className="settings-overview-group">
          <button type="button" onClick={onOpenSessions}>
            <span>Активные сеансы</span>
            <span>
              {sessionsCount ?? '—'}
              <b>›</b>
            </span>
          </button>
          <button type="button" onClick={() => onLogout(false)}>
            <span>Выйти из аккаунта</span>
            <span className="settings-overview-danger">Выйти</span>
          </button>
        </div>
      </section>
    </>
  );
}

function EmailSettings({ user, onBack, showToast }) {
  const [email, setEmail] = useState(user.email || '');

  async function saveEmail(event) {
    event.preventDefault();
    showToast('info', 'Изменение электронной почты пока недоступно');
  }

  return (
    <AccountSubpage
      title="Электронная почта"
      description="Укажите адрес для уведомлений и восстановления доступа."
      onBack={onBack}
    >
      <form className="settings-profile-editor-form" onSubmit={saveEmail}>
        <div className="settings-profile-fields">
          <Field
            label="Электронная почта"
            type="email"
            value={email}
            required
            autoComplete="email"
            placeholder="name@example.com"
            onChange={setEmail}
          />
          <p className="settings-email-hint">
            После изменения адрес может потребоваться подтвердить.
          </p>
        </div>
        <EditorActions saving={false} onCancel={onBack} label="Сохранить почту" />
      </form>
    </AccountSubpage>
  );
}

function PasswordSettings({ saving, setSaving, onBack, showToast }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  async function changePassword(event) {
    event.preventDefault();
    if (newPassword.length < 10)
      return showToast('error', 'Новый пароль должен содержать минимум 10 символов');
    if (newPassword !== confirmation) return showToast('error', 'Пароли не совпадают');
    setSaving(true);
    try {
      await services.authService.changePassword(currentPassword, newPassword);
      showToast('success', 'Пароль изменён');
      onBack();
    } catch (_) {
      showToast('error', 'Не удалось изменить пароль');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccountSubpage
      title="Изменить пароль"
      description="Используйте не менее 10 символов."
      onBack={onBack}
    >
      <form className="settings-profile-editor-form" onSubmit={changePassword}>
        <div className="settings-profile-fields">
          <Field
            label="Текущий пароль"
            type="password"
            value={currentPassword}
            required
            onChange={setCurrentPassword}
          />
          <Field
            label="Новый пароль"
            type="password"
            value={newPassword}
            required
            minLength={10}
            onChange={setNewPassword}
          />
          <Field
            label="Повторите новый пароль"
            type="password"
            value={confirmation}
            required
            onChange={setConfirmation}
          />
        </div>
        <EditorActions saving={saving} onCancel={onBack} label="Изменить пароль" />
      </form>
    </AccountSubpage>
  );
}

function TwoFASettings({
  enabled,
  loading,
  saving,
  setSaving,
  onEnabledChange,
  onBack,
  showToast,
}) {
  const [password, setPassword] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (password.length < 6) return showToast('error', 'Введите пароль 2FA — минимум 6 символов');
    setSaving(true);
    try {
      await services.authService.setTwoFA(!enabled, password);
      onEnabledChange(!enabled);
      showToast('success', enabled ? '2FA отключена' : '2FA включена');
      onBack();
    } catch (_) {
      showToast('error', 'Не удалось изменить настройки 2FA');
    } finally {
      setSaving(false);
    }
  }
  return (
    <AccountSubpage
      title="Двухфакторная аутентификация"
      description="Дополнительная защита при входе в аккаунт."
      onBack={onBack}
    >
      {/* Пока ответ не пришёл, состояние неизвестно — и говорится именно
          это. Написать «отключена» значило бы успокоить человека, который
          пришёл проверить, защищён ли его аккаунт. */}
      <div className={`settings-security-status ${enabled ? 'is-enabled' : ''}`}>
        <span>
          {loading
            ? 'Проверяем состояние защиты…'
            : enabled === undefined
              ? 'Состояние защиты неизвестно'
              : enabled
                ? 'Защита включена'
                : 'Защита отключена'}
        </span>
        <b>{enabled === undefined ? '—' : enabled ? 'Включена' : 'Отключена'}</b>
      </div>
      <form className="settings-profile-editor-form" onSubmit={submit}>
        <div className="settings-profile-fields">
          <Field
            label="Пароль 2FA"
            type="password"
            value={password}
            required
            minLength={6}
            onChange={setPassword}
          />
        </div>
        <EditorActions
          saving={saving}
          onCancel={onBack}
          label={enabled ? 'Отключить 2FA' : 'Включить 2FA'}
          danger={enabled}
        />
      </form>
    </AccountSubpage>
  );
}

function SessionsSettings({ sessions, loading, error, onLogoutAll, onBack }) {
  return (
    <AccountSubpage
      title="Активные сеансы"
      description="Устройства, на которых выполнен вход в аккаунт."
      onBack={onBack}
    >
      {/* Ошибку видно как ошибку: «сеансов нет» здесь читается как «никто
          чужой не входил», и подменять этим неполученный ответ нельзя. */}
      {error && (
        <Banner tone="danger">
          Не удалось получить список устройств. Это не значит, что их нет, — попробуйте обновить
          страницу.
        </Banner>
      )}

      {/* Список пуст не потому, что входов не было: сервер сеансы не
          записывает вовсе — в auth.sessions нет ни одной вставки, только
          чтение и отзыв. Пока это так, «активных сеансов нет» читалось бы
          как «никто чужой не входил», а это не проверено ничем. */}
      {!loading && !error && sessions.length === 0 && (
        <Banner icon="shield" tone="warn">
          Учёт устройств на сервере пока не ведётся, поэтому список всегда пуст. Это не значит, что
          входов с других устройств не было. Завершить все сеансы кнопкой ниже при этом можно — она
          отзывает выданные ранее ключи входа.
        </Banner>
      )}

      <div className="settings-sessions-card">
        {loading ? (
          <div className="settings-sessions-empty">Загрузка…</div>
        ) : sessions.length > 0 ? (
          sessions.map((session, index) => (
            <div className="settings-session-row" key={session.id}>
              <span className="settings-session-device">
                {session.deviceType === 'mobile' ? '▯' : '▱'}
              </span>
              <div>
                <strong>{session.deviceName || 'Устройство'}</strong>
                <span>
                  {session.deviceType || 'unknown'} · {formatDate(session.lastActive)}
                </span>
              </div>
              {index === 0 && <b>Текущий</b>}
            </div>
          ))
        ) : (
          <div className="settings-sessions-empty">
            {error ? 'Список недоступен' : 'Список пуст'}
          </div>
        )}
      </div>
      <button type="button" className="settings-terminate-sessions" onClick={onLogoutAll}>
        Завершить все сеансы
      </button>
    </AccountSubpage>
  );
}

function AccountSubpage({ title, description, onBack, children }) {
  return (
    <section className="settings-profile-editor settings-account-subpage">
      <button type="button" className="settings-detail-back" onClick={onBack}>
        ‹ <span>Назад</span>
      </button>
      <header className="settings-profile-editor-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function EditorActions({ saving, onCancel, label, danger = false }) {
  return (
    <div className="settings-profile-editor-actions">
      <button type="button" className="settings-profile-cancel" onClick={onCancel}>
        Отмена
      </button>
      <button
        className={danger ? 'settings-editor-danger' : 'settings-profile-save'}
        disabled={saving}
      >
        {saving ? 'Сохранение…' : label}
      </button>
    </div>
  );
}

function ProfileSettings({ user, saving, setSaving, onUserChange, onBack, showToast }) {
  const [profile, setProfile] = useState({
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    bio: user.bio || '',
  });

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await services.userService.updateMe(profile);
      onUserChange(updated);
      localStorage.setItem('craneapp_user_data', JSON.stringify(updated));
      showToast('success', 'Профиль обновлён');
      onBack();
    } catch (_) {
      showToast('error', 'Не удалось обновить профиль');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-profile-editor">
      <button type="button" className="settings-detail-back" onClick={onBack}>
        ‹ <span>Назад</span>
      </button>
      <header className="settings-profile-editor-header">
        <h1>Изменить профиль</h1>
        <p>Обновите имя и информацию, которую видят другие пользователи.</p>
      </header>
      <div className="settings-profile-editor-identity">
        <Avatar
          id={user.id}
          name={user.firstName || user.username}
          size="xl"
          src={user.avatarUrl}
        />
        <div>
          <strong>
            {[user.firstName, user.lastName].filter(Boolean).join(' ') ||
              user.username ||
              'Пользователь'}
          </strong>
          <span>@{user.username || 'user'}</span>
        </div>
        <button type="button" disabled title="Загрузка аватара пока недоступна">
          Изменить фото
        </button>
      </div>
      <form className="settings-profile-editor-form" onSubmit={saveProfile}>
        <div className="settings-profile-fields">
          <Field
            label="Имя"
            value={profile.firstName}
            required
            onChange={(value) => setProfile({ ...profile, firstName: value })}
          />
          <Field
            label="Фамилия"
            value={profile.lastName}
            onChange={(value) => setProfile({ ...profile, lastName: value })}
          />
          <Field
            label="О себе"
            value={profile.bio}
            multiline
            maxLength={160}
            onChange={(value) => setProfile({ ...profile, bio: value })}
          />
          <span className="settings-profile-bio-counter">{profile.bio.length}/160</span>
        </div>
        <div className="settings-profile-editor-actions">
          <button type="button" className="settings-profile-cancel" onClick={onBack}>
            Отмена
          </button>
          <button className="settings-profile-save" disabled={saving || !profile.firstName.trim()}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </section>
  );
}

function formatDate(value) {
  if (!value) return 'нет данных';
  return new Date(value).toLocaleString();
}
