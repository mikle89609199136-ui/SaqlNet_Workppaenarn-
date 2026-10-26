import { useTranslation } from 'react-i18next';
import { Link, Navigate, Outlet, useLocation, useMatch } from 'react-router-dom';
import { DEFAULT_SETTINGS_SECTION, ROUTES } from '@/shared/config/routes';
import { useIsMobile } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { settingsHeader } from './settingsHeader';
import { SettingsSidebar } from './SettingsSidebar';

/**
 * Раскладка настроек — по макету (#828): на ПК и планшете две панели на
 * фоне — меню слева, раздел справа со своей шапкой; на телефоне меню и
 * раздел — отдельные экраны.
 *
 * Сам раздел выбирается адресом, а не состоянием: страница расставляет
 * части и отдаёт место под то, что вернул маршрут. Шапка раздела — по
 * адресу: название и «назад» к разделу на подстраницах.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const isPhone = useIsMobile();
  const { pathname } = useLocation();
  /* Раздел и подстраница — параметры дочернего маршрута: useParams
     страницы их не видит, поэтому адрес разбирается здесь же. */
  const match = useMatch(`${ROUTES.SETTINGS}/:section/:subsection?`);
  const { section, subsection } = match?.params ?? {};
  const header = settingsHeader(t, section, subsection, isPhone);

  const showMenu = !isPhone || !section;
  const showMain = !isPhone || Boolean(section);

  return (
    <div className="flex h-full min-h-0 w-full gap-2.5 bg-ground text-ink xl:gap-3">
      {showMenu && (
        <nav
          aria-label={t('settings.menu.aria', 'Разделы настроек')}
          className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden bg-sheet pt-[env(safe-area-inset-top,0px)] md:w-75 md:rounded-window md:pt-0 lg:w-90"
        >
          <SettingsSidebar />
        </nav>
      )}

      {showMain && (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-chat-bg pt-[env(safe-area-inset-top,0px)] md:rounded-window md:pt-0">
          <header className="flex h-16 shrink-0 items-center border-b border-divider px-1.5 md:px-4">
            {header.backTo ? (
              <Link
                aria-label={header.backLabel}
                className="flex h-11 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-button px-2 text-ink hover:layer-hover active:layer-press focus-visible:outline-2 focus-visible:outline-brand"
                to={header.backTo}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-icon text-brand">
                  <Icon className="size-5.5 stroke-2" name="chevronLeft" />
                </span>
                <h2 className="m-0 truncate text-[18px] font-semibold">{header.title}</h2>
              </Link>
            ) : (
              <h2 className="m-0 truncate pl-2 text-[18px] font-semibold">{header.title}</h2>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            {/* Колонка до 640 px по центру; новый раздел проявляется. */}
            <div
              className="mx-auto flex w-full max-w-160 animate-fade-in flex-col gap-5.5 px-3.5 pt-4 pb-[calc(28px+env(safe-area-inset-bottom,0px))] md:px-6 md:pt-6 md:pb-10"
              key={pathname}
            >
              <Outlet />
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

/**
 * `/settings` без раздела: на ПК — первый раздел, чтобы у открытого экрана
 * был свой адрес; на телефоне — меню, оно и есть этот экран.
 */
export function SettingsIndex() {
  const isPhone = useIsMobile();
  if (isPhone) return null;
  return <Navigate replace to={ROUTES.SETTINGS_SECTION(DEFAULT_SETTINGS_SECTION)} />;
}
