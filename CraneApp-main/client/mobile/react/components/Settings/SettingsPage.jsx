import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { services } from '../../../application/services/serviceContainer.js';
import { ToastStack } from '../common/ToastStack.jsx';
import { useToasts } from '../../hooks/useToasts.js';

export function SettingsPage({ t = (k, f) => f }) {
  const navigate = useNavigate();
  const { toasts, showToast } = useToasts();
  const [user, setUser] = useState({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [settings, setSettings] = useState({
    theme: 'dark',
    language: 'ru',
    notifications: true,
    sounds: true,
  });

  const token = localStorage.getItem('craneapp_auth_token');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }

    // Sync profile and settings
    async function syncData() {
      try {
        const [nextUser, settingsPayload] = await Promise.all([
          services.userService.getMe(),
          services.userService.getSettings(),
        ]);

        if (nextUser) {
          setUser(nextUser);
          localStorage.setItem('craneapp_user_data', JSON.stringify(nextUser));
        }

        if (settingsPayload.settings) {
          setSettings(settingsPayload.settings);
          localStorage.setItem('craneapp_settings', JSON.stringify(settingsPayload.settings));
        }
      } catch (e) {
        showToast('error', 'Ошибка синхронизации настроек с сервером', '⚠️');
      }
    }

    syncData();
  }, [token, navigate]);

  async function updateSetting(name, value) {
    const updated = { ...settings, [name]: value };
    setSettings(updated);
    localStorage.setItem('craneapp_settings', JSON.stringify(updated));

    try {
      await services.userService.updateSettings(updated);
      showToast('success', t('settingsSaved', 'Настройки сохранены'), '✓');
    } catch (_) {
      showToast('error', 'Не удалось сохранить настройки на сервере', '⚠️');
    }
  }

  function handleLogout() {
    localStorage.removeItem('craneapp_auth_token');
    localStorage.removeItem('craneapp_user_data');
    localStorage.removeItem('craneapp_settings');
    navigate('/login');
  }

  const userInitials = (user.firstName || user.username || 'U').charAt(0).toUpperCase();

  return (
    <main className="settings-page">
      <ToastStack toasts={toasts} />
      <header className="settings-header">
        <button className="back-arrow-btn" onClick={() => navigate('/chats')}>
          ‹
        </button>
        <h1>{t('settings', 'Настройки')}</h1>
      </header>

      <section className="settings-profile-card">
        <div className="settings-avatar-wrap">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="profile-avatar-img" />
          ) : (
            <span>{userInitials}</span>
          )}
        </div>
        <div className="settings-profile-info">
          <h2>
            {user.firstName || 'Пользователь'}
            {user.statusEmoji ? <span style={{ marginLeft: 8 }}>{user.statusEmoji}</span> : null}
          </h2>
          <p>{user.username ? `@${user.username}` : ''}</p>
          {user.bio && <p style={{ marginTop: 6, opacity: 0.8 }}>{user.bio}</p>}
        </div>
      </section>

      <section className="settings-block-group">
        <div className="settings-row-item" onClick={() => setIsEditModalOpen(true)}>
          <div className="settings-row-left">
            <span className="settings-row-icon">👤</span>
            <span>{t('editProfile', 'Редактировать профиль')}</span>
          </div>
          <div className="settings-row-right">
            <span>›</span>
          </div>
        </div>
      </section>

      <section className="settings-block-group">
        <div className="settings-row-item">
          <div className="settings-row-left">
            <span className="settings-row-icon">🔔</span>
            <span>{t('notifications', 'Уведомления')}</span>
          </div>
          <div
            className={`settings-toggle-switch ${settings.notifications ? 'is-active' : ''}`}
            onClick={() => updateSetting('notifications', !settings.notifications)}
          >
            <div className="settings-toggle-knob" />
          </div>
        </div>

        <div className="settings-row-item">
          <div className="settings-row-left">
            <span className="settings-row-icon">🎵</span>
            <span>{t('sounds', 'Звуки')}</span>
          </div>
          <div
            className={`settings-toggle-switch ${settings.sounds ? 'is-active' : ''}`}
            onClick={() => updateSetting('sounds', !settings.sounds)}
          >
            <div className="settings-toggle-knob" />
          </div>
        </div>
      </section>

      <section className="settings-block-group">
        <div className="settings-row-item" onClick={() => showToast('info', 'Эта функция будет доступна в следующем обновлении', 'ℹ️')}>
          <div className="settings-row-left">
            <span className="settings-row-icon">🎨</span>
            <span>{t('appearance', 'Оформление')}</span>
          </div>
          <div className="settings-row-right">
            <span>{settings.theme === 'dark' ? 'Тёмная' : 'Светлая'}</span>
            <span>›</span>
          </div>
        </div>

        <div className="settings-row-item" onClick={() => showToast('info', 'Эта функция будет доступна в следующем обновлении', 'ℹ️')}>
          <div className="settings-row-left">
            <span className="settings-row-icon">🌐</span>
            <span>{t('language', 'Язык')}</span>
          </div>
          <div className="settings-row-right">
            <span>Русский</span>
            <span>›</span>
          </div>
        </div>
      </section>

      <div className="logout-btn-container">
        <button className="logout-btn-block" onClick={handleLogout}>
          {t('logout', 'Выйти из аккаунта')}
        </button>
      </div>

      {isEditModalOpen && (
        <EditProfileModal
          user={user}
          onClose={() => setIsEditModalOpen(false)}
          onSave={async (updatedFields) => {
            try {
              const updatedUser = await services.userService.updateMe(updatedFields);
              setUser(updatedUser);
              localStorage.setItem('craneapp_user_data', JSON.stringify(updatedUser));
              showToast('success', 'Профиль обновлен', '✓');
              setIsEditModalOpen(false);
            } catch (e) {
              showToast('error', 'Не удалось обновить профиль', '⚠️');
            }
          }}
          t={t}
        />
      )}
    </main>
  );
}

function EditProfileModal({ user, onClose, onSave, t }) {
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [bio, setBio] = useState(user.bio || '');
  const [statusEmoji, setStatusEmoji] = useState(user.statusEmoji || '');
  const [isSaving, setIsSaving] = useState(false);

  const emojiOptions = ['', '😀', '😎', '💼', '🚀', '🔥', '🎉', '✈️', '🎮', '🎧', '😴', '🐱', '🍕', '☕'];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({ firstName, lastName, bio, statusEmoji });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="group-info-modal-overlay" onClick={onClose} style={{ zIndex: 20000 }}>
      <div className="group-info-modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <header className="group-info-header">
          <h2>Редактировать профиль</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </header>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Имя</label>
            <input
              required
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="Имя"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 15
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Фамилия</label>
            <input
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Фамилия"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 15
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>О себе</label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="О себе"
              rows={3}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 15,
                resize: 'none'
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Статус-эмодзи</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {emojiOptions.map(emoji => (
                <button
                  type="button"
                  key={emoji || 'none'}
                  onClick={() => setStatusEmoji(emoji)}
                  style={{
                    fontSize: 18,
                    background: statusEmoji === emoji ? 'var(--rd-accent-grad, #ff2d8b)' : 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    padding: 6,
                    cursor: 'pointer',
                    minWidth: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff'
                  }}
                >
                  {emoji || '✕'}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={isSaving || !firstName.trim()}
            style={{
              marginTop: 10,
              background: 'var(--rd-accent-grad, linear-gradient(135deg, #ff2d8b 0%, #9b5cff 100%))',
              border: 0,
              borderRadius: 8,
              padding: '10px 16px',
              color: '#fff',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </div>
    </div>
  );
}
