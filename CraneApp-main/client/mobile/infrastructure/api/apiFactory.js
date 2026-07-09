import { config } from '../../app/config.js';
import { STORAGE_KEYS } from '../../shared/constants/config.js';
import ApiClient from './ApiClient.js';

export const apiClient = new ApiClient(config.apiBaseUrl, {
  getToken: () => window.localStorage.getItem(STORAGE_KEYS.TOKEN),
});

export default apiClient;
