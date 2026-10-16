import { ROUTES } from '@/shared/config/routes';

/**
 * Куда вернуть человека после входа.
 *
 * `AuthGuard`, выкидывая на вход, дописывает `?from=` — чтобы после
 * входа человек оказался там, где его прервали. Значение приходит из
 * адресной строки, поэтому проверяется: внутренний путь начинается с
 * одной косой черты. `//example.com` — это уже чужой сайт, и переход
 * туда был бы открытым перенаправлением.
 */
export function safeReturnPath(from: string | null): string {
  if (!from || !from.startsWith('/') || from.startsWith('//')) return ROUTES.CHATS;
  return from;
}
