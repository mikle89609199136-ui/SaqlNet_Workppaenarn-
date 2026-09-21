import { useIsMobile } from '@/shared/lib';
import { Outlet, useParams } from 'react-router-dom';
import { BottomNav, SideNav } from '@/widgets/navigation';

export function AppLayout() {
  const { chatId } = useParams();
  const isMobile = useIsMobile();

  return (
    <>
      {isMobile && (
        <div className="mobile-layout">
          <div className="mobile-content">
            <Outlet />
          </div>
          {/* В открытом чате панель убирается: там свой низ — поле ввода. */}
          {!chatId && <BottomNav />}
        </div>
      )}
      {!isMobile && (
        <div className="app-layout">
          <SideNav />
          <div className="app-main-content">
            <Outlet />
          </div>
        </div>
      )}
    </>
  );
}
