import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { services } from '../../../application/services/serviceContainer.js';
import { ToastStack } from '../common/ToastStack.jsx';
import { useToasts } from '../../hooks/useToasts.js';
import { disconnectRealtimeSocket } from '../../hooks/useRealtimeSocket.js';
import '../../styles/SettingsPage.css';
import { useTheme } from '../Context/ThemeContext.jsx';
import { useLanguage } from '../locales/LanguageContext.jsx';
export function SettingsPage({ t = (k, f) => f }) {
  const navigate = useNavigate();
  const { toasts, showToast } = useToasts();
  const [user, setUser] = useState({});
  const [activeSessionsCount, setActiveSessionsCount] = useState(0);

  const token = localStorage.getItem('craneapp_auth_token');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }

    async function syncData() {
      try {
        const [nextUser] = await Promise.all([
          services.userService.getMe(),
        ]);

        if (nextUser) {
          setUser(nextUser);
          localStorage.setItem('craneapp_user_data', JSON.stringify(nextUser));
        }
      } catch (e) {
        showToast('error', 'Ошибка синхронизации данных с сервером', '⚠️');
      }
    }

    syncData();
  }, [token, navigate]);

  async function handleLogout() {
    await services.authService.logout().catch(() => {
      localStorage.removeItem('craneapp_auth_token');
      localStorage.removeItem('craneapp_user_data');
    });
    disconnectRealtimeSocket();
    localStorage.removeItem('craneapp_settings');
    navigate('/login');
  }

  const userInitials = (user.firstName || user.username || 'U').charAt(0).toUpperCase();

  return (
    <main className="settings-page">
      <ToastStack toasts={toasts} />

      {/* Карточка профиля */}
      <h1 className="sidebar-section-title">Аккаунт</h1>
      <section className="settings-profile-card liquid-glass-block">
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
          {user.bio && <p className="user-bio">{user.bio}</p>}
        </div>
        <button 
        className="sidebar-edit-btn"
        onClick={() => {
          onOpenSettings();
          onClose();
        }}
        title="Изменить профиль"
      >
      <span>Изменить профиль</span>
      </button>
      </section>

      {/* Блок: Настройки аккаунта */}
      <h1 className="sidebar-section-title">Настройки аккаунта</h1>
      <section className="settings-block-group liquid-glass-block">
        
        {/* Электронная почта */}
        <div className="settings-row-item placeholder-row">
          <div className="settings-row-left">
            <span>Электронная почта</span>
          </div>
          <div className="settings-row-right">
            <span>{user.email || 'не привязан'}</span>
            <span className="settings-row-arrow">›</span>
          </div>
        </div>

        {/* Пароль */}
        <div className="settings-row-item placeholder-row">
          <div className="settings-row-left">
            <span>Пароль</span>
          </div>
          <div className="settings-row-right">
            <span>••••••••</span>
            <span className="settings-row-arrow">›</span>
          </div>
        </div>

        {/* Двуфакторная аутентификация */}
        <div className="settings-row-item placeholder-row">
          <div className="settings-row-left">
            <span>Двуфакторная аутентификация</span>
          </div>
          <div className="settings-row-right">
            <span>отключена</span>
            <span className="settings-row-arrow">›</span>
          </div>
        </div>
      </section>

      {/* Блок: Сеансы и Выход */}
      <h1 className="sidebar-section-title">Действия</h1>
      <section className="settings-block-group liquid-glass-block">
        {/* Активные сеансы */}
        <div className="settings-row-item placeholder-row">
          <div className="settings-row-left">
            <span>Активные сеансы</span>
          </div>
          <div className="settings-row-right">
            <span>{activeSessionsCount}</span>
            <span className="settings-row-arrow">›</span>
          </div>
        </div>

        {/* Выйти из аккаунта */}
        <div className="settings-row-item logout-row" onClick={handleLogout}>
          <div className="settings-row-left">
            <span>Выйти из аккаунта</span>
          </div>
          <div className="settings-row-right">
            <span className="logout-text">выйти</span>
          </div>
        </div>
      </section>
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