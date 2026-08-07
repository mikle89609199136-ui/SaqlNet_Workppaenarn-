import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { ROUTES } from "../../consts/routes";
import { useIsMobile } from "../../hooks/useIsMobile";
import { cn } from "../../utils/cn";

const ChatsIcon = () => {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
};

const ChannelsIcon = () => {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
};

const CommunitiesIcon = () => {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
};

const MeetingsIcon = () => {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
};

const SettingsIcon = () => {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="12" x2="21" y2="12"></line>
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="3" y1="18" x2="21" y2="18"></line>
    </svg>
  );
};

const navItems = [
  { key: "chats", label: "Чаты", path: ROUTES.CHATS, Icon: ChatsIcon },
  {
    key: "channels",
    label: "Каналы",
    path: ROUTES.CHANNELS,
    Icon: ChannelsIcon,
  },
  {
    key: "communities",
    label: "Сообщества",
    path: ROUTES.COMMUNITIES,
    Icon: CommunitiesIcon,
  },
  {
    key: "meetings",
    label: "Встречи",
    path: ROUTES.MEETINGS,
    Icon: MeetingsIcon,
  },
];

export function AppLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { chatId } = useParams();
  const isMobile = useIsMobile();

  return (
    <>
      {isMobile && (
        <div className="mobile-layout">
          <div className="mobile-content">
            <Outlet />
          </div>
          {!chatId && (
            <div className="nav-rail mobile-nav-rail">
              {/* Чаты */}
              {navItems.map(({ Icon, key, label, path }) => (
                <NavLink
                  key={key}
                  to={path}
                  className={cn(
                    "rail-tab",
                    pathname.includes(path) && "active",
                  )}
                >
                  <Icon />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>
      )}
      {!isMobile && (
        <div className="app-layout">
          <div className="nav-rail">
            <NavLink
              className="rail-burger"
              to={ROUTES.SETTINGS}
              data-tip="Настройки"
            >
              <SettingsIcon />
            </NavLink>

            {navItems.map(({ Icon, key, label, path }) => (
              <NavLink
                key={key}
                to={path}
                className={cn("rail-tab", pathname.includes(path) && "active")}
                data-tip={label}
              >
                <Icon />
              </NavLink>
            ))}

            <div className="rail-spacer"></div>

            <NavLink
              className="rail-help"
              to={ROUTES.SETTINGS}
              data-tip="Настройки"
            >
              <SettingsIcon />
            </NavLink>
          </div>
          <div className="app-main-content">
            <Outlet />
          </div>
        </div>
      )}
    </>
  );
}
