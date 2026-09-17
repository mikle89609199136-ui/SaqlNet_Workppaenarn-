export type TToastType = 'success' | 'error' | 'info' | 'warning';

export interface IToast {
  id: string;
  message: string;
  type: TToastType;
}

/**
 * Очередь уведомлений.
 *
 * Живёт вне дерева намеренно, и не ради «глобального состояния»: показать
 * уведомление нужно из полутора десятков мест, а нарисовать — в одном.
 * Если держать список внутри компонента или контекста, то каждое
 * уведомление перерисовывает всех, кто умеет его показывать, хотя рисует
 * список ровно один `ToastStack`.
 *
 * Здесь же вторая причина: `showToast` — обычная функция, а не хук. Её
 * можно позвать из обработчика сокета или из `catch` в сервисе, где
 * React-дерева нет вовсе. Сейчас такие ошибки уходят в `console.warn` и
 * до человека не доходят.
 */
let toasts: IToast[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function showToast(type: TToastType, message: string) {
  toasts = [...toasts, { id: crypto.randomUUID(), type, message }];
  emit();
}

export function hideToast(id: string) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/* Список пересобирается при каждом изменении, поэтому снимок можно
   отдавать как есть: `useSyncExternalStore` сравнивает по ссылке. */
export function getToasts() {
  return toasts;
}

export function subscribeToToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Очистка между тестами и при выходе из аккаунта. */
export function clearToasts() {
  toasts = [];
  emit();
}
