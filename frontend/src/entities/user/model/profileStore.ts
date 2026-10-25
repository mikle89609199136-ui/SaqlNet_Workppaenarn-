import { STORAGE_KEYS } from '@/shared/config';
import { applyAppearance, normalizePreferences } from './appearancePreferences';
import { DEFAULT_PROFILE_SETTINGS } from './defaultProfileSettings';
import type { ISettingsDto, IUserDto } from './types';
import { create } from 'zustand';

/*
 * Токена здесь нет (#705): сессия — в HttpOnly-cookie, её ставит сервер при
 * входе и отправляет браузер. «Вошёл» — есть сохранённый профиль (isAuth).
 */
interface InitialState {
  isAuth: boolean;
  isLoading: boolean;
  user: IUserDto | null;
  settings: ISettingsDto;
  setUser: (user: IUserDto) => void;
  setSettings: (settings: ISettingsDto) => void;
  updateUser: (data: Partial<Omit<IUserDto, 'id'>>) => void;
  clearProfile: () => void;
}

function readStoredUser(): IUserDto | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER);
    return raw ? (JSON.parse(raw) as IUserDto) : null;
  } catch {
    return null;
  }
}

function readStoredSettings(): ISettingsDto {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const stored = raw ? JSON.parse(raw) : null;
    const ownerId = readStoredUser()?.id;
    return ownerId && stored?.ownerId === ownerId
      ? normalizePreferences(stored)
      : DEFAULT_PROFILE_SETTINGS;
  } catch {
    return DEFAULT_PROFILE_SETTINGS;
  }
}

const storedUser = readStoredUser();

export const useProfileStore = create<InitialState>((set, get) => ({
  user: storedUser,
  settings: readStoredSettings(),
  isAuth: !!storedUser,
  isLoading: false,
  setUser: (user) => {
    if (get().user?.id !== user.id) {
      localStorage.removeItem(STORAGE_KEYS.SETTINGS);
      if (typeof document !== 'undefined') applyAppearance(normalizePreferences(), false);
    }
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    set({ user, isAuth: !!user });
  },
  setSettings: (settings) => {
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ ...settings, ownerId: get().user?.id })
    );
    set({ settings });
  },
  updateUser: (data) => {
    const user = get().user;

    if (!user) return;

    set({ user: { ...user, ...data } });
  },
  clearProfile: () => {
    // Дополнительная очистка токена версии до #705 при явном выходе.
    localStorage.removeItem(STORAGE_KEYS.LEGACY_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    if (typeof document !== 'undefined') applyAppearance(normalizePreferences(), false);
    set({
      settings: DEFAULT_PROFILE_SETTINGS,
      user: null,
      isAuth: false,
    });
  },
}));
