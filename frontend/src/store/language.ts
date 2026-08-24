import { create } from "zustand";

interface InitialState {
  language: "ru" | "en";
  setLanguage: (language: "ru" | "en") => void;
}

export const useLanguageStore = create<InitialState>((set) => ({
  language: "ru",
  setLanguage: (language) => set({ language }),
}));
