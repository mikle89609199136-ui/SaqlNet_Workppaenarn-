import { queryOptions } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { userKeys } from './userKeys';

/**
 * Профиль текущего пользователя.
 *
 * Один запрос на всё приложение. Раньше его делал загрузчик защищённой
 * ветки роутера — на каждой навигации, — и повторял экран настроек,
 * которому те же данные нужны были для показа (#223).
 */
export function meQuery() {
  return queryOptions({
    queryKey: userKeys.me(),
    queryFn: () => services.userService.getMe(),
    // Имя, аватар и описание меняет сам пользователь: после правки
    // запрос инвалидируется, опрашивать сервер незачем.
    staleTime: 5 * 60 * 1000,
  });
}
