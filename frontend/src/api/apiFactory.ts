import { config } from '@/configs/app';
import { STORAGE_KEYS } from '@/consts';
import { ApiClient } from './ApiClient';

export const apiClient = new ApiClient(config.apiBaseUrl, {
  getToken: () => window.localStorage.getItem(STORAGE_KEYS.TOKEN),
});

export default apiClient;
