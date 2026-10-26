import type { IReactionAuthor } from './types';

export function formatAuthorDisplayName(
  author: Pick<IReactionAuthor, 'firstName' | 'lastName' | 'username'>
): string {
  const full = [author.firstName, author.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (author.username) return `@${author.username}`;
  return 'Пользователь';
}

export interface IFormatReactionSummaryOptions {
  authors: IReactionAuthor[];
  total: number;
  mine: boolean;
  currentUserId?: string;
  t?: (key: string, defaultText: string, options?: Record<string, unknown>) => string;
}

/**
 * Форматирует краткую строку авторов реакции для тултипа:
 * - «Вы» / «Вы и Алексей» / «Вы, Алексей и ещё 2»
 * - «Алексей» / «Алексей и Мария» / «Алексей, Мария и ещё 3»
 */
export function formatReactionAuthorsSummary({
  authors,
  total,
  mine,
  currentUserId,
  t = (_key, defaultText) => defaultText,
}: IFormatReactionSummaryOptions): string {
  if (total <= 0) return '';

  const names: string[] = [];

  if (mine) {
    names.push(t('reactions.you', 'Вы'));
  }

  // Фильтруем текущего пользователя из списка авторов, так как он уже учтён как «Вы»
  const otherAuthors =
    mine && currentUserId ? authors.filter((a) => a.id !== currentUserId) : authors;

  const maxNames = mine ? 2 : 2;

  for (const author of otherAuthors) {
    const displayName = formatAuthorDisplayName(author);
    if (!names.includes(displayName)) {
      names.push(displayName);
    }
    if (names.length >= maxNames) {
      break;
    }
  }

  const remaining = total - names.length;

  if (remaining > 0) {
    const list = names.join(', ');
    const countText =
      remaining === 1
        ? t('reactions.andOneOther', 'и ещё 1', { count: remaining })
        : t('reactions.andOthers', 'и ещё {{count}}', { count: remaining });
    const formattedCount = countText.replace('{{count}}', String(remaining));
    return `${list} ${formattedCount}`;
  }

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} ${t('and', 'и')} ${names[1]}`;
  }

  const last = names[names.length - 1];
  const rest = names.slice(0, -1).join(', ');
  return `${rest} ${t('and', 'и')} ${last}`;
}
