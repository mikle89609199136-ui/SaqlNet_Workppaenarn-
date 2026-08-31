import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { disconnectRealtimeSocket } from '../../hooks/useRealtimeSocket';
import { useToasts } from '../../hooks/useToasts';
import { services } from '../../services/serviceContainer';
import '../../styles/SettingsControls.css';
import { Avatar } from '@/components/ui';
import { meQuery } from '@/queries/users/meQuery';
import { settingsQuery } from '@/queries/users/settingsQuery';
import { userKeys } from '@/queries/keys';
import { useUpdatePrivacy, useUpdateSettings } from '@/queries/users/settingsMutations';
import { useProfileStore } from '@/store';
import type { IPrivacyDto, ISettingsDto } from '@/types';
import { ChoiceRow, Field, SettingsSection, ToggleRow } from './SettingsControls';
import { DEFAULT_PROFILE_SETTINGS, STORAGE_KEYS } from '@/consts';
import {
  DEFAULT_SETTINGS_SECTION,
  ROUTES,
  isAccountSubsection,
  isSettingsSection,
  type TAccountSubsection,
} from '@/consts/routes';
import { useTranslation } from 'react-i18next';

interface OutletContext {
  searchQuery: string;
}

export function SettingsDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { searchQuery } = useOutletContext<OutletContext>();
  const params = useParams<{ section: string; subsection: string }>();

  /* Раздел и подстраница берутся из адреса. Неизвестное имя — не ошибка
     и не пустой экран: показываем первый раздел, как и при заходе на
     /settings без указания. */
  const activeTab = isSettingsSection(params.section) ? params.section : DEFAULT_SETTINGS_SECTION;
  const accountView = isAccountSubsection(params.subsection) ? params.subsection : 'overview';

  const openAccountView = (view: TAccountSubsection | 'overview') =>
    navigate(
      view === 'overview'
        ? ROUTES.SETTINGS_SECTION('account')
        : ROUTES.SETTINGS_SUBSECTION('account', view)
    );
  const { showToast } = useToasts();
  const queryClient = useQueryClient();
  const updateSettings = useUpdateSettings();
  const updatePrivacy = useUpdatePrivacy();
  // Профиль загрузчик защищённой ветки уже положил в кеш, поэтому открытие
  // настроек не спрашивает его заново (#223). Настройки он не тянет — их
  // запрашивает эта страница.
  const { data: user = {}, isPending: isUserPending } = useQuery(meQuery());
  const { data: settingsPayload, isPending: isSettingsPending } = useQuery(settingsQuery());
  const loading = isUserPending || isSettingsPending;

  const privacy = settingsPayload?.privacy ?? {};
  // Настройки живут в кеше запросов и больше нигде. Умолчания подставляются
  // здесь, а не при записи: сервер вправе не прислать поле, которого у
  // пользователя ещё нет.
  const settings = { ...DEFAULT_PROFILE_SETTINGS, ...(settingsPayload?.settings ?? {}) };
  // Статус двухфакторной и список сессий сервер пока не отдаёт — запросы
  // закомментированы. Раньше эти значения молча брались из несуществующих
  // элементов Promise.all, и страница показывала «выключено» и «сессий
  // нет» независимо от того, как обстоят дела на самом деле.
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [sessions] = useState([]);
  const [saving, setSaving] = useState(false);

  const query = searchQuery.trim().toLocaleLowerCase();
  const visible = useMemo(() => {
    if (!query) return true;
    const labels = {
      account: 'аккаунт профиль пароль безопасность сессии устройства выход',
      notifications: 'уведомления звуки сообщения звонки',
      appearance: 'внешний вид тема светлая темная',
      privacy: 'конфиденциальность приватность последняя активность сообщения группы',
      language: 'язык русский english',
      about: 'приложение версия экспорт данные',
    };
    return labels[activeTab]?.includes(query);
  }, [activeTab, query]);

  /* Показ значения и откат при ошибке живут в самой мутации, здесь
     остаётся только сообщение: слой данных про интерфейс не знает. */
  function saveSettings(patch: Partial<ISettingsDto>) {
    updateSettings.mutate(patch, {
      onSuccess: () => showToast('success', t('settingsSaved', 'Настройки сохранены')),
      onError: () => showToast('error', 'Не удалось сохранить настройки'),
    });
  }

  function savePrivacy(patch: Partial<IPrivacyDto>) {
    updatePrivacy.mutate(patch, {
      onSuccess: () => showToast('success', 'Настройки приватности сохранены'),
      onError: () => showToast('error', 'Не удалось сохранить настройки приватности'),
    });
  }

  /**
   * Профиль изменил сам пользователь — обновляем оба его представления.
   *
   * Профиль задублирован кешем и стором, и стор читают 65 мест: расселение
   * этой пары — отдельная работа (#241), а не попутная правка. Здесь он
   * остаётся как есть.
   */
  function handleUserChange(next: any) {
    queryClient.setQueryData(userKeys.me(), next);
    useProfileStore.getState().setUser(next);
  }

  async function logout(all = false) {
    if (all) await services.authService.logoutAll().catch(() => {});
    else await services.authService.logout().catch(() => {});

    // Завершение всех сеансов стирает и ключи шифрования: это тот самый
    // случай, ради которого кнопку нажимают — чужой или потерянный
    // компьютер. Обычный выход ключи оставляет.
    if (all) await services.cryptoService.wipeDevice().catch(() => {});

    disconnectRealtimeSocket();
    // Наследие прежней схемы: страница больше сюда не пишет, но у давнего
    // пользователя ключ остался, и чужие настройки не должны пережить выход.
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    navigate('/login');
  }

  if (loading) return <div className="settings-detail-state">Загрузка…</div>;
  if (!visible) return <div className="settings-detail-state">Ничего не найдено</div>;

  return (
    <main className="settings-detail-page">
      {activeTab === 'account' && accountView === 'profile' && (
        <ProfileSettings
          user={user}
          saving={saving}
          setSaving={setSaving}
          onUserChange={handleUserChange}
          onBack={() => openAccountView('overview')}
          showToast={showToast}
        />
      )}
      {activeTab === 'account' && accountView === 'password' && (
        <PasswordSettings
          saving={saving}
          setSaving={setSaving}
          onBack={() => openAccountView('overview')}
          showToast={showToast}
        />
      )}
      {activeTab === 'account' && accountView === 'email' && (
        <EmailSettings
          user={user}
          onBack={() => openAccountView('overview')}
          showToast={showToast}
        />
      )}
      {activeTab === 'account' && accountView === 'twoFA' && (
        <TwoFASettings
          enabled={twoFAEnabled}
          saving={saving}
          setSaving={setSaving}
          onEnabledChange={setTwoFAEnabled}
          onBack={() => openAccountView('overview')}
          showToast={showToast}
        />
      )}
      {activeTab === 'account' && accountView === 'sessions' && (
        <SessionsSettings
          sessions={sessions}
          onLogoutAll={() => logout(true)}
          onBack={() => openAccountView('overview')}
        />
      )}
      {activeTab === 'account' && accountView === 'overview' && (
        <AccountSettings
          user={user}
          sessions={sessions}
          twoFAEnabled={twoFAEnabled}
          onLogout={logout}
          onEditProfile={() => openAccountView('profile')}
          onOpenEmail={() => openAccountView('email')}
          onOpenPassword={() => openAccountView('password')}
          onOpenTwoFA={() => openAccountView('twoFA')}
          onOpenSessions={() => openAccountView('sessions')}
        />
      )}
      {activeTab === 'notifications' && (
        <SettingsSection
          title="Уведомления и звуки"
          description="Настройте поведение уведомлений на этом устройстве."
        >
          <ToggleRow
            label="Уведомления"
            value={settings.notifications}
            onChange={(value) => saveSettings({ notifications: value })}
          />
          <ToggleRow
            label="Звуки сообщений"
            value={settings.sounds}
            onChange={(value) => saveSettings({ sounds: value })}
          />
        </SettingsSection>
      )}
      {activeTab === 'appearance' && (
        <SettingsSection title="Внешний вид" description="Выберите тему интерфейса.">
          <ChoiceRow
            label="Тема"
            value={settings.theme}
            options={[
              { value: 'dark', label: 'Тёмная' },
              { value: 'light', label: 'Светлая' },
            ]}
            onChange={(value: ISettingsDto['theme']) => saveSettings({ theme: value })}
          />
        </SettingsSection>
      )}
      {activeTab === 'privacy' && (
        <SettingsSection
          title="Конфиденциальность"
          description="Управляйте тем, кто видит ваши данные."
        >
          <ChoiceRow
            label="Последняя активность"
            value={privacy.lastSeen || 'all'}
            options={[
              { value: 'all', label: 'Все' },
              { value: 'contacts', label: 'Контакты' },
              { value: 'nobody', label: 'Никто' },
            ]}
            onChange={(value) => savePrivacy({ lastSeen: value })}
          />
          <ToggleRow
            label="Сообщения от незнакомых"
            value={privacy.messagesFromStrangers !== false}
            onChange={(value) => savePrivacy({ messagesFromStrangers: value })}
          />
        </SettingsSection>
      )}
      {activeTab === 'language' && (
        <SettingsSection title="Язык" description="Язык интерфейса CraneApp.">
          <ChoiceRow
            label="Язык приложения"
            value={settings.language}
            options={[
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(value: string) => saveSettings({ language: value })}
          />
        </SettingsSection>
      )}
      {activeTab === 'about' && (
        <SettingsSection title="О приложении" description="CraneApp Messenger">
          <div className="settings-about-version">Версия 2</div>
          <button className="settings-secondary-button" onClick={() => downloadExport(showToast)}>
            Экспортировать мои данные
          </button>
        </SettingsSection>
      )}
    </main>
  );
}

function AccountSettings({
  user,
  sessions,
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
            <span>
              {twoFAEnabled ? 'включена' : 'отключена'}
              <b>›</b>
            </span>
          </button>
        </div>
        <h2>Действия</h2>
        <div className="settings-overview-group">
          <button type="button" onClick={onOpenSessions}>
            <span>Активные сеансы</span>
            <span>
              {sessions.length}
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

function TwoFASettings({ enabled, saving, setSaving, onEnabledChange, onBack, showToast }) {
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
      <div className={`settings-security-status ${enabled ? 'is-enabled' : ''}`}>
        <span>{enabled ? 'Защита включена' : 'Защита отключена'}</span>
        <b>{enabled ? 'Включена' : 'Отключена'}</b>
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

function SessionsSettings({ sessions, onLogoutAll, onBack }) {
  return (
    <AccountSubpage
      title="Активные сеансы"
      description="Устройства, на которых выполнен вход в аккаунт."
      onBack={onBack}
    >
      <div className="settings-sessions-card">
        {sessions.length > 0 ? (
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
          <div className="settings-sessions-empty">Активных сеансов в списке нет</div>
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

async function downloadExport(showToast) {
  try {
    const data = await services.userService.exportData();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'craneapp-data.json';
    link.click();
    URL.revokeObjectURL(url);
  } catch (_) {
    showToast('error', 'Не удалось экспортировать данные');
  }
}

function formatDate(value) {
  if (!value) return 'нет данных';
  return new Date(value).toLocaleString();
}
