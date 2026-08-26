import { ROUTES } from '@/consts';
import { useIsMobile } from '@/hooks';
import type { TIconTypes } from '@/types';
import { cn } from '@/utils';
import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { Icon } from '../ui';

interface INavItem {
  key: string;
  label: string;
  path: string;
  icon: TIconTypes;
}

const navItems: INavItem[] = [
  { key: 'chats', label: 'Чаты', path: ROUTES.CHATS, icon: 'chat' },
  {
    key: 'channels',
    label: 'Каналы',
    path: ROUTES.CHANNELS,
    icon: 'channel',
  },
  {
    key: 'communities',
    label: 'Сообщества',
    path: ROUTES.COMMUNITIES,
    icon: 'users',
  },
  {
    key: 'meetings',
    label: 'Встречи',
    path: ROUTES.MEETINGS,
    icon: 'camera',
  },
];

export function AppLayout() {
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
              {navItems.map(({ icon, key, label, path }) => (
                <NavLink
                  key={key}
                  to={path}
                  className={cn('rail-tab', pathname.includes(path) && 'active')}
                >
                  <Icon name={icon} />
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
            <NavLink className="rail-burger" to={ROUTES.MENU} data-tip="Меню">
              <Icon name="burger" />
            </NavLink>

            {navItems.map(({ icon, key, label, path }) => (
              <NavLink
                key={key}
                to={path}
                className={cn('rail-tab', pathname.includes(path) && 'active')}
                data-tip={label}
              >
                <Icon name={icon} />
              </NavLink>
            ))}

            <div className="rail-spacer"></div>

            <NavLink className="rail-help" to={ROUTES.SETTINGS} data-tip="Настройки">
              <Icon name="settings" />
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
