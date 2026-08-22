import { create } from "zustand";

export type TThemeType = "light" | "dark" | "system";

interface InitialState {
  theme: TThemeType;
  setTheme: (theme: TThemeType) => void;
}

export const useThemeStore = create<InitialState>((set) => ({
  theme: "dark",
  setTheme: (theme) => set({ theme }),
}));
