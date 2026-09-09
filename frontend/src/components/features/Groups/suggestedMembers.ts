import type { IChatDto, ISearchUserDto } from '@/types';

/**
 * Подбирает участников из недавних приватных переписок.
 *
 * Группу почти всегда собирают из тех, с кем уже общаются: выносить их
 * вверх — экономить человеку поиск по буквам. Собеседник из приватного
 * чата подходит сразу, если это не мы сами (чат «Избранное») и если у него
 * есть идентификатор пользователя.
 */
export function suggestedMembers(
  chats: IChatDto[],
  myUserId: string | undefined
): ISearchUserDto[] {
  const seen = new Set<string>();
  const list: ISearchUserDto[] = [];

  for (const chat of chats) {
    if (chat.type !== 'private') continue;

    const id = chat.peerId;
    if (!id || id === myUserId || seen.has(id)) continue;

    seen.add(id);
    list.push({
      id,
      username: chat.title || 'user',
      avatarUrl: chat.avatarUrl ?? null,
    });
  }

  return list;
}
