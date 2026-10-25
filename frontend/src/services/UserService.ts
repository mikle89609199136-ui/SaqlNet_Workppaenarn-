import { API_ENDPOINTS } from '@/shared/api';

export class UserService {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  getMe() {
    return this.apiClient
      .get(API_ENDPOINTS.USERS_ME)
      .then((response) => response.data?.user ?? response.data);
  }

  updateMe(profile) {
    return this.apiClient
      .put(API_ENDPOINTS.USERS_ME, profile)
      .then((response) => response.data?.user ?? response.data);
  }

  updateUsername(username) {
    return this.apiClient
      .put(API_ENDPOINTS.USERS_ME_USERNAME, { username })
      .then((response) => response.data?.user ?? response.data);
  }

  updateAvatar(avatar) {
    return this.apiClient
      .put(API_ENDPOINTS.USERS_AVATAR, { avatar })
      .then((response) => response.data?.user ?? response.data);
  }

  getProfile(userId) {
    return this.apiClient
      .get(API_ENDPOINTS.USER_PROFILE(userId))
      .then((response) => response.data?.user ?? response.data);
  }

  checkUsername(username) {
    return this.apiClient
      .get(API_ENDPOINTS.USER_CHECK_USERNAME, { username })
      .then((response) => response.data);
  }

  getStatus(userId) {
    return this.apiClient.get(API_ENDPOINTS.USER_STATUS(userId)).then((response) => response.data);
  }

  /** Каноническое чтение settings и privacy (#498). */
  getSettings() {
    return this.apiClient.get(API_ENDPOINTS.USER_SETTINGS).then((response) => response.data);
  }

  /** Частичный flat patch общих настроек, без envelope { settings: ... }. */
  updateSettings(settings) {
    return this.apiClient
      .put(API_ENDPOINTS.USER_SETTINGS, settings)
      .then((response) => response.data?.settings ?? response.data);
  }

  /** Частичный patch правил; чтение — через getSettings(). */
  updatePrivacy(privacy) {
    return this.apiClient
      .put(API_ENDPOINTS.USER_PRIVACY, privacy)
      .then((response) => response.data?.privacy ?? response.data);
  }

  getStorage() {
    return this.apiClient.get(API_ENDPOINTS.USER_STORAGE).then((response) => response.data);
  }

  clearStorageCache() {
    return this.apiClient
      .delete(API_ENDPOINTS.USER_STORAGE_CACHE)
      .then((response) => response.data);
  }

  deleteAllData() {
    return this.apiClient.delete(API_ENDPOINTS.USER_STORAGE_ALL).then((response) => response.data);
  }

  exportData() {
    return this.apiClient.get(API_ENDPOINTS.USER_EXPORT).then((response) => response.data);
  }

  listBlocked() {
    return this.apiClient
      .get(API_ENDPOINTS.USER_BLOCKED)
      .then((response) => response.data?.blocked ?? []);
  }

  blockUser(userId) {
    return this.apiClient
      .post(API_ENDPOINTS.USER_BLOCKED, { userId })
      .then((response) => response.data);
  }

  unblockUser(userId) {
    return this.apiClient
      .delete(API_ENDPOINTS.USER_BLOCKED_BY_ID(userId))
      .then((response) => response.data);
  }

  /** Исключения из правил приватности по людям (#784, #786): все правила сразу. */
  listPrivacyExceptions() {
    return this.apiClient
      .get(API_ENDPOINTS.USER_PRIVACY_EXCEPTIONS)
      .then((response) => response.data?.exceptions ?? []);
  }

  /** Добавить в исключения или перевести в другой список: mode — allow | deny. */
  setPrivacyException(rule, userId, mode) {
    return this.apiClient
      .put(API_ENDPOINTS.USER_PRIVACY_EXCEPTION(rule, userId), { mode })
      .then((response) => response.data?.exception);
  }

  removePrivacyException(rule, userId) {
    return this.apiClient
      .delete(API_ENDPOINTS.USER_PRIVACY_EXCEPTION(rule, userId))
      .then((response) => response.data);
  }

  listDevices() {
    return this.apiClient
      .get(API_ENDPOINTS.USER_DEVICES)
      .then((response) => response.data?.devices ?? []);
  }

  registerDevice(device) {
    return this.apiClient
      .post(API_ENDPOINTS.USER_DEVICE_REGISTER, device)
      .then((response) => response.data);
  }

  deleteDevice(sessionId) {
    return this.apiClient
      .delete(API_ENDPOINTS.USER_DEVICE_DELETE(sessionId))
      .then((response) => response.data);
  }

  terminateAllDevices() {
    return this.apiClient
      .post(API_ENDPOINTS.USER_DEVICES_TERMINATE_ALL)
      .then((response) => response.data);
  }
}
