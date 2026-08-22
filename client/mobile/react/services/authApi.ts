import { DEFAULT_PROFILE_SETTINGS } from "@/consts";
import { useProfileStore } from "@/store";
import type { ISettingsDto, IUserDto } from "@/types";
import { services } from "@/services";

export async function registerUser({
  firstName,
  language,
  password,
  username,
}: {
  firstName: string;
  language: string;
  password: string;
  username: string;
}) {
  return services.authService.register({
    firstName,
    language,
    lastName: "",
    password,
    username,
  });
}

export async function loginUser({
  clientIP = "",
  password,
  twoFAPassword,
  username,
}: {
  clientIP: string;
  password: string;
  twoFAPassword: string;
  username: string;
}) {
  return services.authService.login({
    password,
    username,
  });
}

export async function fetchUserSettings() {
  try {
    const data = await services.userService.getSettings();
    return data.settings || DEFAULT_PROFILE_SETTINGS;
  } catch (_error) {
    return DEFAULT_PROFILE_SETTINGS;
  }
}

export function uploadAvatar(avatar: string) {
  if (!avatar) return Promise.resolve();
  return services.userService.updateAvatar(avatar);
}

export function saveAuthSession({
  settings,
  token,
  user,
}: {
  settings: ISettingsDto;
  token: string;
  user: IUserDto;
}) {
  useProfileStore.getState().setToken(token);
  useProfileStore.getState().setUser(user);
  useProfileStore.getState().setSettings(settings);
  window.dispatchEvent(new CustomEvent("craneapp:auth-session-saved"));
}
