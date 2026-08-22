import { DEFAULT_PROFILE_SETTINGS, STORAGE_KEYS } from "@/consts";
import type { ISettingsDto, IUserDto } from "@/types";
import { create } from "zustand";

interface InitialState {
  token: string | null;
  isAuth: boolean;
  isLoading: boolean;
  user: IUserDto | null;
  settings: ISettingsDto;
  setUser: (user: IUserDto) => void;
  setToken: (token: string) => void;
  setSettings: (settings: ISettingsDto) => void;
  updateUser: (data: Partial<Omit<IUserDto, "id">>) => void;
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
    return raw ? (JSON.parse(raw) as ISettingsDto) : DEFAULT_PROFILE_SETTINGS;
  } catch {
    return DEFAULT_PROFILE_SETTINGS;
  }
}

const storedUser = readStoredUser();

export const useProfileStore = create<InitialState>((set, get) => ({
  token: localStorage.getItem(STORAGE_KEYS.TOKEN) || "",
  user: storedUser,
  settings: readStoredSettings(),
  isAuth: !!storedUser,
  isLoading: false,
  setUser: (user) => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    set({ user, isAuth: !!user });
  },
  setToken: (token) => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    set({ token });
  },
  setSettings: (settings) => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    set({ settings });
  },
  updateUser: (data) => {
    const user = get().user;

    if (!user) return;

    set({ user: { ...user, ...data } });
  },
  clearProfile: () => {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    set({
      user: null,
      isAuth: false,
      token: null,
    });
  },
}));
