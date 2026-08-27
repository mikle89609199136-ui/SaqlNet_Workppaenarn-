import type { IChatDto, ISearchUserDto } from '@/types';

/**
 * Кого предложить в новую группу.
 *
 * Тех, с кем уже есть личный чат: почти всегда группу собирают из людей,
 * с которыми и так переписываются, и заставлять искать их по имени —
 * лишняя работа. Список берётся из уже загруженного списка чатов, поэтому
 * ни одного запроса не добавляется.
 *
 * Групповые чаты пропускаются: их участники в списке чатов не видны, а
 * тянуть состав каждой группы ради подсказки — несколько запросов ради
 * догадки.
 */
export function suggestedMembers(chats: IChatDto[], meId: string | undefined): ISearchUserDto[] {
  const seen = new Set<string>();
  const suggested: ISearchUserDto[] = [];

  for (const chat of chats) {
    if (chat.type !== 'private' || !chat.peerId) continue;
    // Чат с самим собой в подсказках не нужен.
    if (chat.peerId === meId || seen.has(chat.peerId)) continue;

    seen.add(chat.peerId);
    suggested.push({
      id: chat.peerId,
      username: '',
      firstName: chat.title || '',
      lastName: '',
      avatarUrl: chat.avatarUrl || '',
    });
  }

  return suggested;
}
