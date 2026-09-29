import { config } from '@/shared/config';
import { ApiClient, type IApiError } from './ApiClient';

interface ICreateApiClientOptions {
  baseUrl?: string;
  onUnauthorized?: (error: IApiError) => void;
}

/**
 * Фабрика для создания изолированного клиента ApiClient.
 * Используется преимущественно в тестах для изоляции состояния.
 */
export function createApiClient(options: ICreateApiClientOptions = {}): ApiClient {
  return new ApiClient(options.baseUrl ?? config.apiBaseUrl, {
    onUnauthorized: options.onUnauthorized,
  });
}

export const apiClient = createApiClient();
