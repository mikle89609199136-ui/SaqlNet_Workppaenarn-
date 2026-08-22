import { config } from "@/configs";
import { STORAGE_KEYS } from "@/consts";
import { ApiClient } from "@/api";

export const apiClient = new ApiClient(config.apiBaseUrl, {
  getToken: () => window.localStorage.getItem(STORAGE_KEYS.TOKEN),
});

export default apiClient;
