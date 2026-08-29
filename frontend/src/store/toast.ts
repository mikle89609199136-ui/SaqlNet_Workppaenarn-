import { create } from 'zustand';

export type TToastType = 'success' | 'error' | 'info' | 'warning';

export interface IToast {
  id: string;
  message: string;
  type: TToastType;
}

interface InitialState {
  toasts: IToast[];
  /* Третий аргумент остался ради вызовов, которые ещё передают эмодзи.
     Он не используется: значок и цвет выводятся из типа, иначе одно и то
     же уведомление выглядит по-разному в разных местах. */
  showToast: (type: TToastType, message: string, legacyIcon?: string) => void;
  hideToast: (id: string) => void;
}

export const useToastStore = create<InitialState>((set) => ({
  toasts: [],

  /* Таймера здесь больше нет. Он живёт в самом уведомлении: только оно
     знает, что на нём курсор, и только оно может остановить отсчёт. */
  showToast: (type, message) =>
    set((state) => ({
      toasts: [...state.toasts, { id: crypto.randomUUID(), type, message }],
    })),

  hideToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
