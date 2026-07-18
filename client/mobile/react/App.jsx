import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation, useNavigate } from 'react-router-dom';
import { RegisterPage } from './components/Auth/RegisterPage.jsx';
import { LoginPage } from './components/Auth/LoginPage.jsx';
import { ChatThreadPage, UserProfilePanel } from './components/Chats/ChatThreadPage.jsx';
import { ChatsPage } from './components/Chats/ChatsPage.jsx';
import { RateLimitPage } from './components/RateLimit/RateLimitPage.jsx';
import { SettingsPage } from './components/Settings/SettingsPage.jsx';
import { ContactsPage } from './components/Contacts/ContactsPage.jsx';
import { CreateGroupPage } from './components/Chats/CreateGroupPage.jsx';
import { CallProvider } from './components/Calls/CallProvider.jsx';
import { CallOverlay } from './components/Calls/CallOverlay.jsx';
import { disconnectRealtimeSocket, useRealtimeSocket } from './hooks/useRealtimeSocket.js';
import { services } from '../application/services/serviceContainer.js';

export function App({ basename = '', forceMobile = false }) {
  const homePath = withBasePath(basename, '/chats');
  const loginPath = withBasePath(basename, '/login');
  const registerPath = withBasePath(basename, '/register');

  return (
    <BrowserRouter basename={basename || undefined}>
      <CallProvider>
        <AuthGuard />
        <CallOverlay />
        <Routes>
          <Route path="/" element={<HomeRoute loginPath="/login" chatsPath="/chats" />} />
          <Route
            path="/login"
            element={
              <LoginPage
                redirectPath={homePath}
                registerHref={registerPath}
                t={translate}
              />
            }
          />
          <Route
            path="/register"
            element={
              <RegisterPage
                redirectPath={homePath}
                loginHref={loginPath}
                t={translate}
              />
            }
          />
          <Route
            path="/chats"
            element={
              <ProtectedRoute>
                <AppLayout forceMobile={forceMobile}><ChatLayout forceMobile={forceMobile} /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/chats/:chatId"
            element={
              <ProtectedRoute>
                <AppLayout forceMobile={forceMobile}><ChatLayout forceMobile={forceMobile} /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/rate-limit"
            element={
              <RateLimitPage
                retryAfter={60}
                onBack={() => window.history.back()}
                t={translate}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <AppLayout forceMobile={forceMobile}><SettingsPage t={translate} /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/contacts"
            element={
              <ProtectedRoute>
                <AppLayout forceMobile={forceMobile}><ContactsPage t={translate} /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/create-group"
            element={
              <ProtectedRoute>
                <AppLayout forceMobile={forceMobile}><CreateGroupPage t={translate} /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CallProvider>
      <NotificationManager />
    </BrowserRouter>
  );
}

function NotificationManager() {
  const token = localStorage.getItem('craneapp_auth_token');
  const { eventBus } = useRealtimeSocket(!!token);

  useEffect(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    return eventBus.on('new_message', (payload) => {
      if (!document.hidden) return;
      if (Notification.permission !== 'granted') return;
      const msg = payload?.message ?? payload ?? {};
      const title = msg.senderName || 'CraneApp';
      const body = typeof msg.content === 'string' ? msg.content.slice(0, 120) : 'Новое сообщение';
      try {
        new Notification(title, { body, icon: '/favicon.ico', tag: msg.chatId });
      } catch (_) {}
    });
  }, [eventBus]);

  return null;
}

function HomeRoute({ loginPath, chatsPath }) {
  const token = localStorage.getItem('craneapp_auth_token');
  return token ? <Navigate to={chatsPath} replace /> : <Navigate to={loginPath} replace />;
}

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('craneapp_auth_token');
  return token ? children : <Navigate to="/login" replace />;
}

function useIsMobile() {
  const mq = window.matchMedia('(max-width: 767px)');
  const [isMobile, setIsMobile] = useState(mq.matches);
  useEffect(() => {
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

function AppLayout({ children, forceMobile = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { chatId } = useParams();
  const isMobileScreen = useIsMobile();
  const isMobile = forceMobile || isMobileScreen;
  
  let activeTab = 'chats';
  if (location.pathname.startsWith('/contacts')) activeTab = 'contacts';
  else if (location.pathname.startsWith('/settings')) activeTab = 'settings';
  
  const handleTabSelect = (tab) => {
    if (tab === 'chats') navigate('/chats');
    else if (tab === 'contacts') navigate('/contacts');
    else if (tab === 'settings') navigate('/settings');
  };

  if (isMobile) {
    const showTabBar = !chatId && (location.pathname === '/chats' || location.pathname === '/contacts' || location.pathname === '/settings');
    return (
      <div className="mobile-layout">
        <div className="mobile-content">{children}</div>
        {showTabBar && (
          <div className="nav-rail">
            <button className={`rail-tab ${activeTab === 'chats' ? 'active' : ''}`} onClick={() => handleTabSelect('chats')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
              <span>Чаты</span>
            </button>
            <button className={`rail-tab ${activeTab === 'contacts' ? 'active' : ''}`} onClick={() => handleTabSelect('contacts')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
              </svg>
              <span>Контакты</span>
            </button>
            <button className={`rail-tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => handleTabSelect('settings')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              <span>Настройки</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-layout">
      <div className="nav-rail">
        <button className="rail-burger" onClick={() => navigate('/settings')} data-tip="Настройки">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        <button className={`rail-tab ${activeTab === 'chats' ? 'active' : ''}`} onClick={() => handleTabSelect('chats')} data-tip="Чаты">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </button>

        <button className={`rail-tab ${activeTab === 'contacts' ? 'active' : ''}`} onClick={() => handleTabSelect('contacts')} data-tip="Контакты">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </button>

        <button className="rail-tab" onClick={() => alert('Раздел в разработке')} data-tip="Каналы">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5L6 9H2v6h4l5 4V5z"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
        </button>

        <button className="rail-tab" onClick={() => alert('Раздел в разработке')} data-tip="Сообщества">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
          </svg>
        </button>

        <button className="rail-tab" onClick={() => alert('Раздел в разработке')} data-tip="Встречи">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
        </button>

        <div className="rail-spacer"></div>

        <button className="rail-help" onClick={() => navigate('/settings')} data-tip="Настройки">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
      <div className="app-main-content">{children}</div>
    </div>
  );
}

function ChatLayout({ forceMobile = false }) {
  const { chatId } = useParams();
  const isMobileScreen = useIsMobile();
  const isMobile = forceMobile || isMobileScreen;
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [profileWidth, setProfileWidth] = useState(null);
  const [profileState, setProfileState] = useState({ isOpen: false, isLoading: false, error: '', user: null, chat: null });
  const [profileCloseToken, setProfileCloseToken] = useState(0);

  if (isMobile) {
    if (chatId) {
      return <ChatThreadPage chatId={chatId} t={translate} />;
    } else {
      return <ChatsPage t={translate} />;
    }
  }

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
    <div className={`chat-workspace ${profileState.isOpen ? 'has-profile' : ''}`}>
      <div className="app-sidebar-pane" style={{ flexBasis: sidebarWidth }}>
        <ChatsPage t={translate} />
      </div>
      <div
        aria-label="Изменить ширину списка чатов"
        className="app-pane-resizer app-pane-resizer-sidebar"
        onPointerDown={(event) => startResize('sidebar', event)}
        role="separator"
      />
      <div className="app-chat-pane">
        {chatId ? (
          <ChatThreadPage
            chatId={chatId}
            onProfileStateChange={setProfileState}
            profileCloseToken={profileCloseToken}
            profileMode="panel"
            t={translate}
          />
        ) : (
          <div className="empty-chat-placeholder">
            <div className="empty-chat-icon">💬</div>
            <h3>Выберите чат</h3>
            <p>Выберите контакт или чат из списка слева, чтобы начать общение.</p>
          </div>
        )}
      </div>
      {profileState.isOpen ? (
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

function AuthGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    function handleUnauthorized() {
      clearAuthSession();
      navigateRef.current('/login', { replace: true });
    }
    window.addEventListener('craneapp:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('craneapp:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('craneapp_auth_token');
    const isPublicRoute = location.pathname === '/login' || location.pathname === '/register' || location.pathname === '/rate-limit';
    if (!token || isPublicRoute) return undefined;

    let cancelled = false;
    services.userService.getMe().catch(() => {
      if (cancelled) return;
      clearAuthSession();
      navigateRef.current('/login', { replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  return null;
}

function clearAuthSession() {
  disconnectRealtimeSocket();
  localStorage.removeItem('craneapp_auth_token');
  localStorage.removeItem('craneapp_user_data');
  localStorage.removeItem('craneapp_settings');
}

function translate(key, fallback, vars) {
  const val = window.i18n?.t(key, vars);
  return (val && val !== key) ? val : fallback;
}

function withBasePath(basePath, path) {
  if (!basePath) return path;
  return `${basePath}${path}`;
}
