import API_ENDPOINTS from '../../infrastructure/api/endpoints.js';

class UserService {
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

  getSettings() {
    return this.apiClient
      .get(API_ENDPOINTS.USER_SETTINGS)
      .then((response) => response.data);
  }

  updateSettings(settings) {
    return this.apiClient
      .put(API_ENDPOINTS.USER_SETTINGS, settings)
      .then((response) => response.data?.settings ?? response.data);
  }

  updatePrivacy(privacy) {
    return this.apiClient
      .put(API_ENDPOINTS.USER_PRIVACY, privacy)
      .then((response) => response.data?.privacy ?? response.data);
  }

  getNotifications() {
    return this.getPreference(API_ENDPOINTS.USER_NOTIFICATIONS);
  }

  updateNotifications(settings) {
    return this.updatePreference(API_ENDPOINTS.USER_NOTIFICATIONS, settings);
  }

  getSounds() {
    return this.getPreference(API_ENDPOINTS.USER_SOUNDS);
  }

  updateSounds(settings) {
    return this.updatePreference(API_ENDPOINTS.USER_SOUNDS, settings);
  }

  getAdvancedSettings() {
    return this.getPreference(API_ENDPOINTS.USER_ADVANCED_SETTINGS);
  }

  updateAdvancedSettings(settings) {
    return this.updatePreference(API_ENDPOINTS.USER_ADVANCED_SETTINGS, settings);
  }

  getFolders() {
    return this.apiClient
      .get(API_ENDPOINTS.USER_FOLDERS)
      .then((response) => response.data?.folders ?? []);
  }

  updateFolders(folders) {
    return this.apiClient
      .put(API_ENDPOINTS.USER_FOLDERS, { folders })
      .then((response) => response.data);
  }

  getStorage() {
    return this.apiClient
      .get(API_ENDPOINTS.USER_STORAGE)
      .then((response) => response.data);
  }

  updateStorageSettings(settings) {
    return this.apiClient
      .put(API_ENDPOINTS.USER_STORAGE_SETTINGS, settings)
      .then((response) => response.data?.settings ?? response.data);
  }

  clearStorageCache() {
    return this.apiClient
      .delete(API_ENDPOINTS.USER_STORAGE_CACHE)
      .then((response) => response.data);
  }

  deleteAllData() {
    return this.apiClient
      .delete(API_ENDPOINTS.USER_STORAGE_ALL)
      .then((response) => response.data);
  }

  exportData() {
    return this.apiClient
      .get(API_ENDPOINTS.USER_EXPORT)
      .then((response) => response.data);
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

  getPreference(endpoint) {
    return this.apiClient
      .get(endpoint)
      .then((response) => response.data?.settings ?? response.data);
  }

  updatePreference(endpoint, settings) {
    return this.apiClient
      .put(endpoint, settings)
      .then((response) => response.data?.settings ?? response.data);
  }
}

export default UserService;
