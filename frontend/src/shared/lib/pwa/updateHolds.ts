/**
 * Что не даёт перезагрузить приложение прямо сейчас (#892): идёт звонок,
 * записывается голосовое. Перезагрузка оборвала бы и то и другое, поэтому
 * «Обновить» ждёт, пока все поводы не снимут.
 *
 * Реестр — в shared: ставят его разные фичи, а читает features/app-update,
 * и фичи друг друга не импортируют.
 */

export type TUpdateHoldReason = 'call' | 'recording';

const holds = new Map<symbol, TUpdateHoldReason>();
const listeners = new Set<() => void>();

function announce(): void {
  listeners.forEach((listener) => listener());
}

/** Отложить обновление; вернувшаяся функция снимает повод (повторно — без эффекта). */
export function holdAppUpdate(reason: TUpdateHoldReason): () => void {
  const key = Symbol(reason);
  holds.set(key, reason);
  announce();
  return () => {
    if (holds.delete(key)) announce();
  };
}

/** Поводы подождать; пусто — перезагружаться можно. */
export function appUpdateHolds(): TUpdateHoldReason[] {
  return [...new Set(holds.values())];
}

export function subscribeAppUpdateHolds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
