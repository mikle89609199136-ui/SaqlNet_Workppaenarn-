import { STORAGE_KEYS } from '../consts/storageKeys.js';
import services from './serviceContainer.js';

export async function registerUser({ firstName, language, password, username }) {
  return services.authService.register({ firstName, language, lastName: '', password, username });
}

export async function loginUser({ clientIP = '', password, twoFAPassword, username }) {
  return services.authService.login({ clientIP, password, twoFAPassword, username });
}

export async function fetchUserSettings(token) {
  try {
    const data = await services.userService.getSettings();
    return data.settings || defaultSettings();
  } catch (_error) {
    return defaultSettings();
  }

  return defaultSettings();
}

export function uploadAvatar({ avatar, token }) {
  if (!avatar) return Promise.resolve();
  return services.userService.updateAvatar(avatar);
}

export function saveAuthSession({ language = 'ru', settings, token, user }) {
  localStorage.setItem(STORAGE_KEYS.TOKEN, token);
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({
    avatarUrl: user.avatarUrl || '',
    bio: user.bio || '',
    firstName: user.firstName,
    id: user.id,
    lastName: user.lastName || '',
    username: user.username,
  }));
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings || defaultSettings(language)));
  window.dispatchEvent(new CustomEvent('craneapp:auth-session-saved'));
}

function defaultSettings(language = 'ru') {
  return {
    language,
    notifications: true,
    sounds: true,
    theme: 'dark',
  };
}
