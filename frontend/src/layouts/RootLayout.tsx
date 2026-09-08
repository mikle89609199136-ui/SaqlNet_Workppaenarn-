import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import { AvatarShapeProvider, ToastStack } from '@/shared/ui';
import { DEFAULT_PROFILE_SETTINGS } from '@/shared/config';
import { useApplyPreferences } from '@/hooks/useApplyPreferences';
import { settingsQuery } from '@/queries/users/settingsQuery';

export const RootLayout = () => {
  // Тема и язык — свойства всего приложения, а не страницы настроек:
  // выбранное там должно действовать и на входе, и в чатах.
  useApplyPreferences();

  /* Вид аватарки раздаётся тем же способом и оттуда же — из кеша.
     Запрос отсюда не делается: на странице входа сессии ещё нет, а на
     защищённых страницах настройки уже положил загрузчик. */
  const { data } = useQuery({ ...settingsQuery(), enabled: false });
  const avatarShape = data?.settings?.avatarShape ?? DEFAULT_PROFILE_SETTINGS.avatarShape;

  return (
    <AvatarShapeProvider value={avatarShape}>
      <ToastStack />
      <Outlet />
    </AvatarShapeProvider>
  );
};
