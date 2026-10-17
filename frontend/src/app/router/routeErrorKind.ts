export type TRouteErrorKind = 'offline' | 'notFound' | 'failed';

/**
 * Какой экран показать вместо маршрута (#1071).
 *
 * Без сети любой сбой — офлайн, и эта проверка первая. По `TypeError` его
 * не узнать: исключение при отрисовке тоже бывает `TypeError`. 400, 403 и
 * 404 — «не найдено»: и несуществующий чат, и адрес не-UUID, и чужой.
 */
export function routeErrorKind(error: unknown, isOnline: boolean): TRouteErrorKind {
  if (!isOnline) return 'offline';
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 400 || status === 403 || status === 404) return 'notFound';
  return 'failed';
}
