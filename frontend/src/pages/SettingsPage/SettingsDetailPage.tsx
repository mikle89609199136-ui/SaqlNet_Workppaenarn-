import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { disconnectRealtimeSocket } from "../../hooks/useRealtimeSocket";
import { useToasts } from "../../hooks/useToasts";
import { services } from "../../services/serviceContainer";
import "../../styles/SettingsControls.css";
import { useLanguageStore, useProfileStore, useThemeStore, type TThemeType } from "@/store";
import { DEFAULT_PROFILE_SETTINGS } from "@/consts";
import { useTranslation } from "react-i18next";

interface Props {
  activeTab: string,
  searchQuery: string
}

export function SettingsDetailPage({ activeTab, searchQuery}: Props) {
  const {t} = useTranslation()
  const navigate = useNavigate();
  const { showToast } = useToasts();
  const theme = useThemeStore(state => state.theme);
  const setTheme = useThemeStore(state => state.setTheme);
  const language = useLanguageStore(state => state.language);
  const setLanguage = useLanguageStore(state => state.setLanguage);
  const [user, setUser] = useState({});
  const [privacy, setPrivacy] = useState({});
  const [sessions, setSessions] = useState([]);
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accountView, setAccountView] = useState("overview");
  const settings = useProfileStore(state => state.settings)
  const setSettings = useProfileStore(state => state.setSettings)

  useEffect(() => {
    setAccountView("overview");
  }, [activeTab]);

  useEffect(() => {
    let active = true;
    Promise.all([
      services.userService.getMe(),
      services.userService.getSettings(),
      // services.authService.twoFAStatus(),
      // services.authService.sessions(),
    ])
      .then(([nextUser, payload, enabled, nextSessions]) => {
        if (!active) return;
        setUser(nextUser || {});
        setSettings({ ...DEFAULT_PROFILE_SETTINGS, ...(payload?.settings || {}) });
        setPrivacy(payload?.privacy || {});
        setTwoFAEnabled(enabled || false);
        setSessions(nextSessions || []);
        if (nextUser) {
          localStorage.setItem("craneapp_user_data", JSON.stringify(nextUser));
        }
      })
      .catch(() => showToast("error", "Не удалось загрузить настройки", "⚠️"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [showToast]);

  const query = searchQuery.trim().toLocaleLowerCase();
  const visible = useMemo(() => {
    if (!query) return true;
    const labels = {
      account: "аккаунт профиль пароль безопасность сессии устройства выход",
      notifications: "уведомления звуки сообщения звонки",
      appearance: "внешний вид тема светлая темная",
      privacy: "конфиденциальность приватность последняя активность сообщения группы",
      language: "язык русский english",
      about: "приложение версия экспорт данные",
    };
    return labels[activeTab]?.includes(query);
  }, [activeTab, query]);

  async function saveSettings(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem("craneapp_settings", JSON.stringify(next));
    try {
      await services.userService.updateSettings(next);
      showToast("success", t("settingsSaved", "Настройки сохранены"), "✓");
    } catch (_) {
      showToast("error", "Не удалось сохранить настройки", "⚠️");
    }
  }

  async function savePrivacy(patch) {
    const next = { ...privacy, ...patch };
    setPrivacy(next);
    try {
      await services.userService.updatePrivacy(next);
      showToast("success", "Настройки приватности сохранены", "✓");
    } catch (_) {
      showToast("error", "Не удалось сохранить настройки приватности", "⚠️");
    }
  }

  async function logout(all = false) {
    if (all) await services.authService.logoutAll().catch(() => {});
    else await services.authService.logout().catch(() => {});
    disconnectRealtimeSocket();
    localStorage.removeItem("craneapp_settings");
    navigate("/login");
  }

  if (loading) return <div className="settings-detail-state">Загрузка…</div>;
  if (!visible) return <div className="settings-detail-state">Ничего не найдено</div>;

  return (
    <main className="settings-detail-page">
      {activeTab === "account" && accountView === "profile" && <ProfileSettings
          user={user}
          saving={saving}
          setSaving={setSaving}
          onUserChange={setUser}
          onBack={() => setAccountView("overview")}
          showToast={showToast}
        />}
      {activeTab === "account" && accountView === "password" && <PasswordSettings saving={saving} setSaving={setSaving} onBack={() => setAccountView("overview")} showToast={showToast} />}
      {activeTab === "account" && accountView === "email" && <EmailSettings user={user} onBack={() => setAccountView("overview")} showToast={showToast} />}
      {activeTab === "account" && accountView === "twoFA" && <TwoFASettings enabled={twoFAEnabled} saving={saving} setSaving={setSaving} onEnabledChange={setTwoFAEnabled} onBack={() => setAccountView("overview")} showToast={showToast} />}
      {activeTab === "account" && accountView === "sessions" && <SessionsSettings sessions={sessions} onLogoutAll={() => logout(true)} onBack={() => setAccountView("overview")} />}
      {activeTab === "account" && accountView === "overview" && <AccountSettings
          user={user}
          sessions={sessions}
          twoFAEnabled={twoFAEnabled}
          onLogout={logout}
          onEditProfile={() => setAccountView("profile")}
          onOpenEmail={() => setAccountView("email")}
          onOpenPassword={() => setAccountView("password")}
          onOpenTwoFA={() => setAccountView("twoFA")}
          onOpenSessions={() => setAccountView("sessions")}
        />
      }
      {activeTab === "notifications" && (
        <SettingsSection title="Уведомления и звуки" description="Настройте поведение уведомлений на этом устройстве.">
          <ToggleRow label="Уведомления" value={settings.notifications} onChange={(value) => saveSettings({ notifications: value })} />
          <ToggleRow label="Звуки сообщений" value={settings.sounds} onChange={(value) => saveSettings({ sounds: value })} />
        </SettingsSection>
      )}
      {activeTab === "appearance" && (
        <SettingsSection title="Внешний вид" description="Выберите тему интерфейса.">
          <ChoiceRow label="Тема" value={theme} options={[{ value: "dark", label: "Тёмная" }, { value: "light", label: "Светлая" }]} onChange={(value: {value: TThemeType, label: string}) => { setTheme(value.value); saveSettings({ theme: value.value }); }} />
        </SettingsSection>
      )}
      {activeTab === "privacy" && (
        <SettingsSection title="Конфиденциальность" description="Управляйте тем, кто видит ваши данные.">
          <ChoiceRow label="Последняя активность" value={privacy.lastSeen || "all"} options={[{ value: "all", label: "Все" }, { value: "contacts", label: "Контакты" }, { value: "nobody", label: "Никто" }]} onChange={(value) => savePrivacy({ lastSeen: value })} />
          <ToggleRow label="Сообщения от незнакомых" value={privacy.messagesFromStrangers !== false} onChange={(value) => savePrivacy({ messagesFromStrangers: value })} />
        </SettingsSection>
      )}
      {activeTab === "language" && (
        <SettingsSection title="Язык" description="Язык интерфейса CraneApp.">
          <ChoiceRow label="Язык приложения" value={language} options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]} onChange={(value: {value: 'ru' | "en", label: string}) => { setLanguage(value.value); saveSettings({ language: value.value }); }} />
        </SettingsSection>
      )}
      {activeTab === "about" && (
        <SettingsSection title="О приложении" description="CraneApp Messenger">
          <div className="settings-about-version">Версия 2</div>
          <button className="settings-secondary-button" onClick={() => downloadExport(showToast)}>Экспортировать мои данные</button>
        </SettingsSection>
      )}
    </main>
  );
}

function AccountSettings({ user, sessions, twoFAEnabled, onLogout, onEditProfile, onOpenEmail, onOpenPassword, onOpenTwoFA, onOpenSessions }) {
  const initials = (user.firstName || user.username || "U").slice(0, 1).toUpperCase();
  return (
    <>
      <section className="settings-account-overview">
        <h1>Аккаунт</h1>
        <div className="settings-account-summary settings-overview-profile">
          <div className="settings-account-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</div>
          <div className="settings-account-identity">
            <strong>{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Пользователь"}</strong>
            <span>{user.online ? "в сети" : `@${user.username || "user"}`}</span>
          </div>
          <button type="button" className="settings-edit-profile" onClick={onEditProfile}>Изменить профиль</button>
        </div>
        <h2>Настройки аккаунта</h2>
        <div className="settings-overview-group">
          <button type="button" onClick={onOpenEmail}><span>Электронная почта</span><span>{user.email || "не привязана"}<b>›</b></span></button>
          <button type="button" onClick={onOpenPassword}><span>Пароль</span><span>•••••••••• <b>›</b></span></button>
          <button type="button" onClick={onOpenTwoFA}><span>Двухфакторная аутентификация</span><span>{twoFAEnabled ? "включена" : "отключена"}<b>›</b></span></button>
        </div>
        <h2>Действия</h2>
        <div className="settings-overview-group">
          <button type="button" onClick={onOpenSessions}><span>Активные сеансы</span><span>{sessions.length}<b>›</b></span></button>
          <button type="button" onClick={() => onLogout(false)}><span>Выйти из аккаунта</span><span className="settings-overview-danger">Выйти</span></button>
        </div>
      </section>
    </>
  );
}

function EmailSettings({ user, onBack, showToast }) {
  const [email, setEmail] = useState(user.email || "");

  async function saveEmail(event) {
    event.preventDefault();
    showToast("info", "Изменение электронной почты пока недоступно", "ℹ️");
  }

  return <AccountSubpage title="Электронная почта" description="Укажите адрес для уведомлений и восстановления доступа." onBack={onBack}>
    <form className="settings-profile-editor-form" onSubmit={saveEmail}>
      <div className="settings-profile-fields">
        <Field label="Электронная почта" type="email" value={email} required autoComplete="email" placeholder="name@example.com" onChange={setEmail} />
        <p className="settings-email-hint">После изменения адрес может потребоваться подтвердить.</p>
      </div>
      <EditorActions saving={false} onCancel={onBack} label="Сохранить почту" />
    </form>
  </AccountSubpage>;
}

function PasswordSettings({ saving, setSaving, onBack, showToast }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  async function changePassword(event) {
    event.preventDefault();
    if (newPassword.length < 10) return showToast("error", "Новый пароль должен содержать минимум 10 символов", "⚠️");
    if (newPassword !== confirmation) return showToast("error", "Пароли не совпадают", "⚠️");
    setSaving(true);
    try {
      await services.authService.changePassword(currentPassword, newPassword);
      showToast("success", "Пароль изменён", "✓");
      onBack();
    } catch (_) {
      showToast("error", "Не удалось изменить пароль", "⚠️");
    } finally { setSaving(false); }
  }

  return <AccountSubpage title="Изменить пароль" description="Используйте не менее 10 символов." onBack={onBack}>
    <form className="settings-profile-editor-form" onSubmit={changePassword}>
      <div className="settings-profile-fields">
        <Field label="Текущий пароль" type="password" value={currentPassword} required onChange={setCurrentPassword} />
        <Field label="Новый пароль" type="password" value={newPassword} required minLength={10} onChange={setNewPassword} />
        <Field label="Повторите новый пароль" type="password" value={confirmation} required onChange={setConfirmation} />
      </div>
      <EditorActions saving={saving} onCancel={onBack} label="Изменить пароль" />
    </form>
  </AccountSubpage>;
}

function TwoFASettings({ enabled, saving, setSaving, onEnabledChange, onBack, showToast }) {
  const [password, setPassword] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (password.length < 6) return showToast("error", "Введите пароль 2FA — минимум 6 символов", "⚠️");
    setSaving(true);
    try {
      await services.authService.setTwoFA(!enabled, password);
      onEnabledChange(!enabled);
      showToast("success", enabled ? "2FA отключена" : "2FA включена", "✓");
      onBack();
    } catch (_) {
      showToast("error", "Не удалось изменить настройки 2FA", "⚠️");
    } finally { setSaving(false); }
  }
  return <AccountSubpage title="Двухфакторная аутентификация" description="Дополнительная защита при входе в аккаунт." onBack={onBack}>
    <div className={`settings-security-status ${enabled ? "is-enabled" : ""}`}><span>{enabled ? "Защита включена" : "Защита отключена"}</span><b>{enabled ? "Включена" : "Отключена"}</b></div>
    <form className="settings-profile-editor-form" onSubmit={submit}>
      <div className="settings-profile-fields"><Field label="Пароль 2FA" type="password" value={password} required minLength={6} onChange={setPassword} /></div>
      <EditorActions saving={saving} onCancel={onBack} label={enabled ? "Отключить 2FA" : "Включить 2FA"} danger={enabled} />
    </form>
  </AccountSubpage>;
}

function SessionsSettings({ sessions, onLogoutAll, onBack }) {
  return <AccountSubpage title="Активные сеансы" description="Устройства, на которых выполнен вход в аккаунт." onBack={onBack}>
    <div className="settings-sessions-card">
      {sessions.length > 0 ? sessions.map((session, index) => <div className="settings-session-row" key={session.id}>
        <span className="settings-session-device">{session.deviceType === "mobile" ? "▯" : "▱"}</span>
        <div><strong>{session.deviceName || "Устройство"}</strong><span>{session.deviceType || "unknown"} · {formatDate(session.lastActive)}</span></div>
        {index === 0 && <b>Текущий</b>}
      </div>) : <div className="settings-sessions-empty">Активных сеансов в списке нет</div>}
    </div>
    <button type="button" className="settings-terminate-sessions" onClick={onLogoutAll}>Завершить все сеансы</button>
  </AccountSubpage>;
}

function AccountSubpage({ title, description, onBack, children }) {
  return <section className="settings-profile-editor settings-account-subpage">
    <button type="button" className="settings-detail-back" onClick={onBack}>‹ <span>Назад</span></button>
    <header className="settings-profile-editor-header"><h1>{title}</h1><p>{description}</p></header>
    {children}
  </section>;
}

function EditorActions({ saving, onCancel, label, danger = false }) {
  return <div className="settings-profile-editor-actions">
    <button type="button" className="settings-profile-cancel" onClick={onCancel}>Отмена</button>
    <button className={danger ? "settings-editor-danger" : "settings-profile-save"} disabled={saving}>{saving ? "Сохранение…" : label}</button>
  </div>;
}

function ProfileSettings({ user, saving, setSaving, onUserChange, onBack, showToast }) {
  const [profile, setProfile] = useState({ firstName: user.firstName || "", lastName: user.lastName || "", bio: user.bio || "" });
  const initials = (user.firstName || user.username || "U").slice(0, 1).toUpperCase();

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await services.userService.updateMe(profile);
      onUserChange(updated);
      localStorage.setItem("craneapp_user_data", JSON.stringify(updated));
      showToast("success", "Профиль обновлён", "✓");
      onBack();
    } catch (_) {
      showToast("error", "Не удалось обновить профиль", "⚠️");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-profile-editor">
      <button type="button" className="settings-detail-back" onClick={onBack}>‹ <span>Назад</span></button>
      <header className="settings-profile-editor-header">
        <h1>Изменить профиль</h1>
        <p>Обновите имя и информацию, которую видят другие пользователи.</p>
      </header>
      <div className="settings-profile-editor-identity">
        <div className="settings-account-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</div>
        <div><strong>{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Пользователь"}</strong><span>@{user.username || "user"}</span></div>
        <button type="button" disabled title="Загрузка аватара пока недоступна">Изменить фото</button>
      </div>
      <form className="settings-profile-editor-form" onSubmit={saveProfile}>
        <div className="settings-profile-fields">
          <Field label="Имя" value={profile.firstName} required onChange={(value) => setProfile({ ...profile, firstName: value })} />
          <Field label="Фамилия" value={profile.lastName} onChange={(value) => setProfile({ ...profile, lastName: value })} />
          <Field label="О себе" value={profile.bio} multiline maxLength={160} onChange={(value) => setProfile({ ...profile, bio: value })} />
          <span className="settings-profile-bio-counter">{profile.bio.length}/160</span>
        </div>
        <div className="settings-profile-editor-actions">
          <button type="button" className="settings-profile-cancel" onClick={onBack}>Отмена</button>
          <button className="settings-profile-save" disabled={saving || !profile.firstName.trim()}>{saving ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </form>
    </section>
  );
}

function SettingsSection({ title, description, children }) {
  return <section className="settings-detail-section"><header><h1>{title}</h1><p>{description}</p></header><div className="settings-detail-card">{children}</div></section>;
}

function Field({ label, multiline = false, onChange, type = "text", value, ...props }) {
  const Tag = multiline ? "textarea" : "input";
  return <label className="settings-field"><span>{label}</span><Tag type={multiline ? undefined : type} value={value} onChange={(event) => onChange(event.target.value)} rows={multiline ? 3 : undefined} {...props} /></label>;
}

function ToggleRow({ label, value, onChange }) {
  return <div className="settings-control-row"><span>{label}</span><button type="button" aria-pressed={value} className={`settings-toggle-switch ${value ? "is-active" : ""}`} onClick={() => onChange(!value)}><span className="settings-toggle-knob" /></button></div>;
}

function ChoiceRow({ label, value, options, onChange }) {
  const detailsRef = useRef(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!detailsRef.current?.contains(event.target)) {
        detailsRef.current?.removeAttribute("open");
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  function selectOption(nextValue) {
    onChange(nextValue);
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <div className="settings-control-row">
      <span>{label}</span>
      <details className="settings-choice" ref={detailsRef}>
        <summary>
          <span>{selected?.label}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </summary>
        <div className="settings-choice-menu">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={option.value === value ? "active" : ""}
              onClick={() => selectOption(option.value)}
            >
              <span className="settings-choice-check">{option.value === value ? "✓" : ""}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

async function downloadExport(showToast) {
  try {
    const data = await services.userService.exportData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "craneapp-data.json";
    link.click();
    URL.revokeObjectURL(url);
  } catch (_) {
    showToast("error", "Не удалось экспортировать данные", "⚠️");
  }
}

function formatDate(value) {
  if (!value) return "нет данных";
  return new Date(value).toLocaleString();
}
