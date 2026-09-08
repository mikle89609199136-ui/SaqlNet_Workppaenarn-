import { config, STORAGE_KEYS } from '@/shared/config';
import { ApiClient } from './ApiClient';

/**
 * Клиент с настройками приложения: адрес из окружения, токен из localStorage.
 *
 * Сам `ApiClient` об окружении не знает — принимает адрес строкой, а токен
 * функцией. Склейка живёт здесь, поэтому класс остаётся переносимым: его
 * можно импортировать где угодно, в том числе в тестах без DOM.
 *
 * Функция стоит рядом с синглтоном ради тестов: им нужен свой экземпляр,
 * не общий с приложением.
 */
export function createApiClient(): ApiClient {
  return new ApiClient(config.apiBaseUrl, {
    getToken: () => globalThis.localStorage?.getItem(STORAGE_KEYS.TOKEN) ?? null,
  });
}

/** Общий клиент приложения. Берёт его один `services/serviceContainer`. */
export const apiClient = createApiClient();
