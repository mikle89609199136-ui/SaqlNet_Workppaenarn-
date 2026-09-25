import { apiClient } from '@/shared/api';
import type { ApiClient, IApiError } from '@/shared/api';
import { isUserFacingAuthError } from './authErrors';

/**
 * Обработчик непредвиденного 401 от сервера.
 *
 * Если статус 401 не относится к известным пользовательским ошибкам ввода
 * (неверный пароль, 2FA и т.д.), объявляет о завершении сессии.
 * Событие слушает AuthGuard на уровне маршрутизатора.
 */
export function handleAuthUnauthorized(error: IApiError): void {
  if (!isUserFacingAuthError(error.code)) {
    globalThis.dispatchEvent?.(new CustomEvent('craneapp:unauthorized'));
  }
}

/**
 * Регистрирует реакцию авторизации на 401 в экземпляре ApiClient.
 *
 * Вызывается на этапе старта приложения (main.tsx), изолируя транспортный
 * слой shared/api от знания бизнес-логики и сценариев фичи auth.
 */
export function registerAuthInterceptor(client: ApiClient = apiClient): void {
  client.setOnUnauthorized(handleAuthUnauthorized);
}
