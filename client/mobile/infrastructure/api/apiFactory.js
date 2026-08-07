import { config } from '../../react/configs/app.js';
import { STORAGE_KEYS } from '../../react/consts/storageKeys.js';
import ApiClient from './ApiClient.js';

export const apiClient = new ApiClient(config.apiBaseUrl, {
  getToken: () => window.localStorage.getItem(STORAGE_KEYS.TOKEN),
});

export default apiClient;
