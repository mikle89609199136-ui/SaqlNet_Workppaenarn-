import { useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ChatsPage } from './ChatsPage.jsx';
import { SettingsSidebar } from '../Settings/SettingsSidebar.jsx';
import SettingsDetailPage from '../Settings/SettingsDetailPage.jsx';
import { ChatThreadPage, UserProfilePanel } from './ChatThreadPage.jsx';
import { CreateGroupPage } from '../Chats/CreateGroupPage.jsx';

export function ChatWorkspace({ forceMobile = false, translate }) {
  const { chatId } = useParams();
  const location = useLocation();
  const isSettingsOpen = location.pathname.startsWith('/settings');
  const navigate = useNavigate();
  // Состояние активной вкладки настроек
  const [activeSettingsTab, setActiveSettingsTab] = useState('appearance');

  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [profileWidth, setProfileWidth] = useState(null);
  const [profileState, setProfileState] = useState({ isOpen: false, isLoading: false, error: '', user: null, chat: null });
  const [profileCloseToken, setProfileCloseToken] = useState(0);
  const isCreatingGroup = location.pathname.includes('/create-group');

  // Умный клин для закрытия
  const handleCloseCreateGroup = () => {
    if (chatId) {
      navigate(`/chats/${chatId}`); // Возвращаемся в текущий чат
    } else {
      navigate('/'); // Возвращаемся на главную
    }
  };

  // Ресайзер для боковой панели
  function startResize(kind, event) {
    event.preventDefault();
    const startX = event.clientX;
    const startSidebarWidth = sidebarWidth;
    const startProfileWidth = profileWidth || Math.round(window.innerWidth * 0.25);

    function handleMove(moveEvent) {
      if (kind === 'sidebar') {
        const nextWidth = Math.min(Math.max(startSidebarWidth + moveEvent.clientX - startX, 280), 520);
        setSidebarWidth(nextWidth);
      } else {
        const nextWidth = Math.min(Math.max(startProfileWidth - (moveEvent.clientX - startX), 300), 560);
        setProfileWidth(nextWidth);
      }
    }

    function handleUp() {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  return (
    <div className={`chat-workspace ${isSettingsOpen ? 'is-settings-active' : ''} ${profileState.isOpen ? 'has-profile' : ''}`}>
      
      {/* ЛЕВАЯ КОЛОНКА (Список чатов ИЛИ Список вкладок настроек) */}
      <div className="app-sidebar-pane" style={{ flexBasis: sidebarWidth }}>
        
        {/* Панель со списком чатов */}
        <div className={`sidebar-slide-layer chats-layer ${isSettingsOpen ? 'slide-out' : 'slide-in'}`}>
          <ChatsPage t={translate} />
        </div>

        {/* Сайдбар настроек (список категорий) */}
        <div className={`sidebar-slide-layer settings-layer ${isSettingsOpen ? 'slide-in' : 'slide-out'}`}>
          <SettingsSidebar
            activeTab={activeSettingsTab}
            onSelectTab={setActiveSettingsTab}
            t={translate}
          />
        </div>

      </div>

      {/* Ресайзер для сайдбара */}
      <div
        aria-label="Изменить ширину боковой панели"
        className="app-pane-resizer app-pane-resizer-sidebar"
        onPointerDown={(event) => startResize('sidebar', event)}
        role="separator"
      />

      {/* ЦЕНТРАЛЬНАЯ/ПРАВАЯ ОБЛАСТЬ (Детали настроек ИЛИ Чат) */}
      <div className="app-chat-pane" style={{ position: 'relative', overflow: 'hidden', height: '100%' }}>
        {isSettingsOpen ? (
          /* Если открыты настройки — показываем выбранную вкладку справа */
          <SettingsDetailPage
            activeTab={activeSettingsTab}
            t={translate}
          />
        ) : chatId ? (
          /* Если открыт чат */
          <ChatThreadPage
            chatId={chatId}
            onProfileStateChange={setProfileState}
            profileCloseToken={profileCloseToken}
            profileMode="panel"
            t={translate}
          />
          
          
        ) : (
          /* Пустой экран */
          <div className="empty-chat-placeholder">
            <div className="empty-chat-icon">💬</div>
            <h3>Выберите чат</h3>
            <p>Выберите контакт или чат из списка слева, чтобы начать общение.</p>
          </div>
        )}
        {isCreatingGroup && (
          <CreateGroupPage 
            onClose={handleCloseCreateGroup} 
            t={translate} 
          />
        )}
      </div>

      {/* Панель профиля пользователя справа (отображается только если настройки НЕ открыты) */}
      {profileState.isOpen && !isSettingsOpen ? (
        <>
          <div
            aria-label="Изменить ширину профиля"
            className="app-pane-resizer app-pane-resizer-profile"
            onPointerDown={(event) => startResize('profile', event)}
            role="separator"
          />
          <div
            className="app-profile-pane"
            style={profileWidth ? { flexBasis: profileWidth } : undefined}
          >
            <UserProfilePanel
              chat={profileState.chat}
              error={profileState.error}
              isLoading={profileState.isLoading}
              messages={profileState.messages}
              onClose={() => {
                setProfileState({ isOpen: false, isLoading: false, error: '', user: null, chat: null });
                setProfileCloseToken((value) => value + 1);
              }}
              t={translate}
              user={profileState.user}
            />
          </div>
        </>
      ) : null}

    </div>
  );
}