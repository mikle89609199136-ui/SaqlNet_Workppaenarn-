import { Outlet } from 'react-router-dom';
import { ToastStack } from '@/components/ui';
import { useApplyPreferences } from '@/hooks/useApplyPreferences';

export const RootLayout = () => {
  // Тема и язык — свойства всего приложения, а не страницы настроек:
  // выбранное там должно действовать и на входе, и в чатах.
  useApplyPreferences();

  return (
    <>
      <ToastStack />
      <Outlet />
    </>
  );
};
