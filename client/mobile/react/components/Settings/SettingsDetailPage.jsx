import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { services } from '../../../application/services/serviceContainer.js';
import { ToastStack } from '../common/ToastStack.jsx';
import { useToasts } from '../../hooks/useToasts.js';
import { disconnectRealtimeSocket } from '../../hooks/useRealtimeSocket.js';
import { useTheme } from '../Context/ThemeContext.jsx';
import { useLanguage } from '../locales/LanguageContext.jsx';
import '../../styles/SettingsPage.css';

export function SettingsDetailPage({ activeTab, t }) {
  const navigate = useNavigate();
  const { toasts, showToast } = useToasts();
  const { theme, setTheme } = useTheme?.() || { theme: 'dark', setTheme: () => {} };
  const { g, lang, changeLanguage } = useLanguage?.() || {
    g: (k, f) => f,
    lang: 'ru',
    changeLanguage: () => {},
  };

  const [user, setUser] = useState({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // 1. Уведомления и звуки
  const [notifications, setNotifications] = useState({
    enabled: true,
    messages: true,
    mentions: true,
    calls: true,
    reactions: true,
    soundEnabled: true,
    soundMelody: 'default',
  });

  // 2. Внешний вид
  const [accentColor, setAccentColor] = useState('#7c5dfa');
  const [fontSize, setFontSize] = useState('medium');
  const [animationsEnabled, setAnimationsEnabled] = useState(true);

  // 3. Конфиденциальность
  const [privacy, setPrivacy] = useState({
    onlineStatus: 'everyone',
    canMessage: 'everyone',
    readReceipts: true,
  });

  const token = localStorage.getItem('craneapp_auth_token');

  // Синхронизация профиля и настроек с сервером
  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }

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

        if (settingsPayload?.settings) {
          const s = settingsPayload.settings;
          if (s.notifications) setNotifications(s.notifications);
          if (s.accentColor) setAccentColor(s.accentColor);
          if (s.fontSize) setFontSize(s.fontSize);
          if (s.animationsEnabled !== undefined) setAnimationsEnabled(s.animationsEnabled);
          if (s.privacy) setPrivacy(s.privacy);

          localStorage.setItem('craneapp_settings', JSON.stringify(s));
        }
      } catch (e) {
        showToast('error', 'Ошибка синхронизации настроек с сервером', '⚠️');
      }
    }

    syncData();
  }, [token, navigate]);

  // Сохранение настроек на сервер и в localStorage
  const saveSettings = async (updatedPart) => {
    const current = JSON.parse(localStorage.getItem('craneapp_settings') || '{}');
    const updated = { ...current, ...updatedPart };
    localStorage.setItem('craneapp_settings', JSON.stringify(updated));

    try {
      await services.userService.updateSettings(updated);
      showToast('success', t ? t('settingsSaved', 'Настройки сохранены') : 'Настройки сохранены', '✓');
    } catch (_) {
      showToast('error', 'Не удалось сохранить настройки на сервере', '⚠️');
    }
  };

  const handleLanguageChange = (selectedLang) => {
    if (changeLanguage) {
      changeLanguage(selectedLang);
    }
    localStorage.setItem('app_lang', selectedLang);
    saveSettings({ language: selectedLang });
  };

  const handleAccentChange = (color) => {
    setAccentColor(color);
    document.documentElement.style.setProperty('--accent-color', color);
    saveSettings({ accentColor: color });
  };

  const toggleNotification = (key) => {
    setNotifications((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveSettings({ notifications: next });
      return next;
    });
  };

  const handleLogout = async () => {
    await services.authService.logout().catch(() => {
      localStorage.removeItem('craneapp_auth_token');
      localStorage.removeItem('craneapp_user_data');
    });
    disconnectRealtimeSocket();
    localStorage.removeItem('craneapp_settings');
    navigate('/login');
  };

  const userInitials = (user.firstName || user.username || 'U').charAt(0).toUpperCase();

  return (
    <div className="settings-detail-pane">
      <ToastStack toasts={toasts} />
      <div className="settings-detail-container">
        
        {/* ================= 0. АККАУНТ ================= */}
        {activeTab === 'account' && (
          <div className="settings-section">
            <h3>{t ? t('account', 'Аккаунт') : 'Аккаунт'}</h3>

            <div className="setting-row account-hero-row">
              <div className="account-profile-info">
                <div className="settings-avatar-wrap">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="Avatar" className="account-avatar" />
                  ) : (
                    <span className="user-initials">{userInitials}</span>
                  )}
                </div>
                <div className="setting-info">
                  <label className="user-name">
                    {user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Пользователь'}
                    {user.statusEmoji && <span style={{ marginLeft: 8 }}>{user.statusEmoji}</span>}
                  </label>
                  <p className="user-handle">{user.username ? `@${user.username}` : ''}</p>
                  {user.bio && <p className="user-bio" style={{ marginTop: 4, opacity: 0.8, fontSize: 13 }}>{user.bio}</p>}
                </div>
              </div>
              <button className="settings-secondary-btn" onClick={() => setIsEditModalOpen(true)}>
                {t ? t('editProfile', 'Редактировать профиль') : 'Изменить профиль'}
              </button>
            </div>

            <div className="settings-subsection-title">Настройки аккаунта</div>

            <div className="setting-row action-row">
              <div className="setting-info">
                <label>Электронная почта</label>
              </div>
              <button className="settings-secondary-btn">
                {user.email || 'не привязана'} &gt;
              </button>
            </div>

            <div className="setting-row action-row">
              <div className="setting-info">
                <label>Пароль</label>
              </div>
              <button className="settings-secondary-btn">•••••••••••• &gt;</button>
            </div>

            <div className="settings-subsection-title">Действия</div>

            <div className="setting-row action-row logout-row" onClick={handleLogout}>
              <div className="setting-info">
                <label style={{ cursor: 'pointer', color: '#ef4444' }}>
                  {t ? t('logout', 'Выйти из аккаунта') : 'Выйти из аккаунта'}
                </label>
              </div>
              <button className="settings-secondary-btn" style={{ color: '#ef4444' }}>
                выйти
              </button>
            </div>
          </div>
        )}

        {/* ================= 1. УВЕДОМЛЕНИЯ ================= */}
        {activeTab === 'notifications' && (
          <div className="settings-section">
            <h3 className="section-header">{t ? t('notifications', 'Уведомления и звуки') : 'Уведомления и звуки'}</h3>

            <div className="setting-card">
              <div className="setting-row">
                <div className="setting-info">
                  <label>Push-уведомления</label>
                  <p>Включить или отключить все всплывающие уведомления</p>
                </div>
                <input
                  type="checkbox"
                  className="toggle-checkbox"
                  checked={notifications.enabled}
                  onChange={() => toggleNotification('enabled')}
                />
              </div>

              {notifications.enabled && (
                <>
                  <div className="setting-divider" />
                  <div className="setting-row">
                    <label>Сообщения</label>
                    <input type="checkbox" checked={notifications.messages} onChange={() => toggleNotification('messages')} />
                  </div>
                  <div className="setting-row">
                    <label>Упоминания (@mentions)</label>
                    <input type="checkbox" checked={notifications.mentions} onChange={() => toggleNotification('mentions')} />
                  </div>
                  <div className="setting-row">
                    <label>Входящие звонки</label>
                    <input type="checkbox" checked={notifications.calls} onChange={() => toggleNotification('calls')} />
                  </div>
                  <div className="setting-row">
                    <label>Реакции на сообщения</label>
                    <input type="checkbox" checked={notifications.reactions} onChange={() => toggleNotification('reactions')} />
                  </div>
                </>
              )}
            </div>

            {notifications.enabled && (
              <div className="setting-card">
                <div className="setting-row">
                  <div className="setting-info">
                    <label>{t ? t('sounds', 'Звуки уведомлений') : 'Звук уведомлений'}</label>
                  </div>
                  <input type="checkbox" checked={notifications.soundEnabled} onChange={() => toggleNotification('soundEnabled')} />
                </div>

                {notifications.soundEnabled && (
                  <div className="setting-row">
                    <label>Мелодия</label>
                    <select
                      value={notifications.soundMelody}
                      onChange={(e) => {
                        const val = e.target.value;
                        const nextNotif = { ...notifications, soundMelody: val };
                        setNotifications(nextNotif);
                        saveSettings({ notifications: nextNotif });
                      }}
                    >
                      <option value="default">Стандартная</option>
                      <option value="chime">Перезвон (Chime)</option>
                      <option value="pop">Всплывающий (Pop)</option>
                      <option value="subtle">Тихий клик</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= 2. ВНЕШНИЙ ВИД ================= */}
        {activeTab === 'appearance' && (
          <div className="settings-section">
            <h3 className="section-header">{t ? t('appearance', 'Внешний вид') : 'Внешний вид'}</h3>

            <div className="setting-card">
              <div className="setting-row">
                <div className="setting-info">
                  <label>Тема оформления</label>
                  <p>Выберите наиболее удобную цветовую схему</p>
                </div>
                <select
                  value={theme}
                  onChange={(e) => {
                    const nextTheme = e.target.value;
                    setTheme(nextTheme);
                    saveSettings({ theme: nextTheme });
                  }}
                >
                  <option value="dark">🌙 Тёмная</option>
                  <option value="light">☀️ Светлая</option>
                  <option value="system">💻 Системная</option>
                </select>
              </div>

              <div className="setting-divider" />

              <div className="setting-row">
                <div className="setting-info">
                  <label>Акцентный цвет</label>
                </div>
                <div className="color-palette">
                  {['#7c5dfa', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'].map((color) => (
                    <button
                      key={color}
                      className={`color-swatch ${accentColor === color ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => handleAccentChange(color)}
                    />
                  ))}
                </div>
              </div>

              <div className="setting-divider" />

              <div className="setting-row">
                <div className="setting-info">
                  <label>Размер шрифта</label>
                </div>
                <select
                  value={fontSize}
                  onChange={(e) => {
                    setFontSize(e.target.value);
                    saveSettings({ fontSize: e.target.value });
                  }}
                >
                  <option value="small">Мелкий</option>
                  <option value="medium">Стандартный</option>
                  <option value="large">Крупный</option>
                </select>
              </div>
            </div>

            <div className="setting-card">
              <div className="setting-row">
                <div className="setting-info">
                  <label>Анимации интерфейса</label>
                  <p>Экономия батареи и ресурсов устройства</p>
                </div>
                <input
                  type="checkbox"
                  checked={animationsEnabled}
                  onChange={(e) => {
                    setAnimationsEnabled(e.target.checked);
                    saveSettings({ animationsEnabled: e.target.checked });
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ================= 3. КОНФИДЕНЦИАЛЬНОСТЬ ================= */}
        {activeTab === 'privacy' && (
          <div className="settings-section">
            <h3 className="section-header">{t ? t('privacy', 'Конфиденциальность') : 'Конфиденциальность'}</h3>

            <div className="setting-card">
              <div className="setting-row">
                <div className="setting-info">
                  <label>Кто видит статус «В сети»</label>
                </div>
                <select
                  value={privacy.onlineStatus}
                  onChange={(e) => {
                    const next = { ...privacy, onlineStatus: e.target.value };
                    setPrivacy(next);
                    saveSettings({ privacy: next });
                  }}
                >
                  <option value="everyone">Все</option>
                  <option value="contacts">Мои контакты</option>
                  <option value="nobody">Никто</option>
                </select>
              </div>

              <div className="setting-divider" />

              <div className="setting-row">
                <div className="setting-info">
                  <label>Отчёт о прочтении</label>
                  <p>Отключает галочки прочтения для собеседников</p>
                </div>
                <input
                  type="checkbox"
                  checked={privacy.readReceipts}
                  onChange={(e) => {
                    const next = { ...privacy, readReceipts: e.target.checked };
                    setPrivacy(next);
                    saveSettings({ privacy: next });
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ================= 4. ЯЗЫКИ ================= */}
        {activeTab === 'language' && (
          <div className="settings-section">
            <h3 className="section-header">{g ? g('language', 'Язык интерфейса') : 'Язык интерфейса'}</h3>

            <div className="lang-grid">
              {[
                { code: 'ru', label: 'Русский', native: 'Русский' },
                { code: 'en', label: 'English', native: 'English' },
                { code: 'kk', label: 'Қазақша', native: 'Қазақша' },
              ].map((languageItem) => (
                <div
                  key={languageItem.code}
                  className={`lang-card ${lang === languageItem.code ? 'selected' : ''}`}
                  onClick={() => handleLanguageChange(languageItem.code)}
                >
                  <div className="lang-info">
                    <span className="lang-title">{languageItem.native}</span>
                    <span className="lang-sub">{languageItem.label}</span>
                  </div>
                  {lang === languageItem.code && (
                    <div className="checkmark-icon">✓</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= 5. О ПРИЛОЖЕНИИ ================= */}
        {activeTab === 'about' && (
          <div className="settings-section about-page">
            <div className="about-hero">
              <div className="app-logo"><img src="/logo.png" alt="CraneApp Logo" className="app-logo-img" /></div>
              <h3>CraneApp</h3>
              <span className="version-badge">Версия 1.4.2 (Build 2026.08)</span>
            </div>

            <div className="setting-card">
              <button className="settings-btn-link" onClick={() => alert('У вас установлена последняя версия!')}>
                Проверить обновления
              </button>
              <div className="setting-divider" />
              <a className="settings-btn-link" href="/terms" target="_blank" rel="noreferrer">
                Условия использования
              </a>
              <div className="setting-divider" />
              <a className="settings-btn-link" href="/privacy" target="_blank" rel="noreferrer">
                Политика конфиденциальности
              </a>
            </div>
          </div>
        )}

      </div>

      {/* Модальное окно редактирования профиля */}
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
    </div>
  );
}

/* Модальное окно профиля */
function EditProfileModal({ user, onClose, onSave }) {
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
      <div className="group-info-modal-content glass-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
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
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Имя"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 15,
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Фамилия</label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Фамилия"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 15,
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>О себе</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="О себе"
              rows={3}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 15,
                resize: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Статус-эмодзи</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {emojiOptions.map((emoji) => (
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
                    color: '#fff',
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
              cursor: 'pointer',
            }}
          >
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SettingsDetailPage;