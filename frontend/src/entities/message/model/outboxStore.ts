import type { IMessageEntity } from '@/shared/lib/richText';
import type { IVoiceMeta } from '@/shared/lib/voice';
import type { TMessageDeliveryStatus, TMessageType } from './types';
import { create } from 'zustand';

export interface IOutboxItem {
  tempId: string;
  chatId: string;
  content: string;
  /** Форматирование: при повторе после сбоя оно не должно потеряться. */
  entities?: IMessageEntity[];
  type: TMessageType;
  file?: File | Blob;
  mediaUrl?: string;
  /** Пересжать фото перед загрузкой; после пересжатия снимается — повтор не сжимает заново. */
  optimizeImage?: boolean;
  /** Длительность и волна голосового (#843): уедут в шифрованном конверте. */
  voice?: IVoiceMeta;
  replyToId?: string | null;
  status: TMessageDeliveryStatus;
  blobUrl?: string;
  error?: string;
  createdAt: Date;
  retryCount?: number;
  lastAttemptAt?: number;
}

interface IOutboxState {
  items: IOutboxItem[];
  addItem: (item: IOutboxItem) => void;
  updateItem: (tempId: string, patch: Partial<IOutboxItem>) => void;
  removeItem: (tempId: string) => void;
  getItem: (tempId: string) => IOutboxItem | undefined;
  getItemsByChat: (chatId: string) => IOutboxItem[];
  getRetryableItems: (chatId?: string) => IOutboxItem[];
  clearAll: () => void;
}

/**
 * Очередь исходящих сообщений в памяти вкладки.
 *
 * Сообщения попадают сюда сразу при отправке, чтобы интерфейс мог мгновенно
 * отобразить баббл в ленте и очистить поле ввода.
 *
 * На диск (localStorage) очередь намеренно не сохраняется: Blob URL и
 * открытые тексты не должны переживать закрытие вкладки.
 */
export const useOutboxStore = create<IOutboxState>((set, get) => ({
  items: [],

  addItem: (item) => set((state) => ({ items: [...state.items, item] })),

  updateItem: (tempId, patch) =>
    set((state) => ({
      items: state.items.map((item) => (item.tempId === tempId ? { ...item, ...patch } : item)),
    })),

  removeItem: (tempId) => {
    const item = get().items.find((i) => i.tempId === tempId);
    if (item?.blobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(item.blobUrl);
      } catch {
        // Игнорируем ошибку отзыва, если URL уже был освобождён
      }
    }
    set((state) => ({ items: state.items.filter((i) => i.tempId !== tempId) }));
  },

  getItem: (tempId) => get().items.find((i) => i.tempId === tempId),

  getItemsByChat: (chatId) => get().items.filter((i) => i.chatId === chatId),

  getRetryableItems: (chatId) =>
    get().items.filter(
      (i) => (!chatId || i.chatId === chatId) && (i.status === 'failed' || i.status === 'pending')
    ),

  clearAll: () => {
    get().items.forEach((item) => {
      if (item.blobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(item.blobUrl);
        } catch {
          // Игнорируем ошибку отзыва
        }
      }
    });
    set({ items: [] });
  },
}));

export const addOutboxItem = (item: IOutboxItem): void => useOutboxStore.getState().addItem(item);
export const updateOutboxItem = (tempId: string, patch: Partial<IOutboxItem>): void =>
  useOutboxStore.getState().updateItem(tempId, patch);
export const removeOutboxItem = (tempId: string): void =>
  useOutboxStore.getState().removeItem(tempId);
export const getOutboxItem = (tempId: string): IOutboxItem | undefined =>
  useOutboxStore.getState().getItem(tempId);
export const getChatOutbox = (chatId: string): IOutboxItem[] =>
  useOutboxStore.getState().getItemsByChat(chatId);
export const getRetryableOutboxItems = (chatId?: string): IOutboxItem[] =>
  useOutboxStore.getState().getRetryableItems(chatId);
export const clearOutbox = (): void => useOutboxStore.getState().clearAll();
