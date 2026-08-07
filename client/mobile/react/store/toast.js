import { create } from "zustand";

export const useToastStore = create((set) => ({
  toasts: [],

  showToast: (type, message, icon) => {
    const id = crypto.randomUUID();

    set((state) => ({
      toasts: [...state.toasts, { id, type, message, icon }],
    }));

    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 3000);
  },
}));
