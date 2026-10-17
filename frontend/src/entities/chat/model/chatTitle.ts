import type { TFunction } from 'i18next';
import type { IChatDto } from './types';

/** «Избранное» — чат с самим собой (#719, #1075). */
export function isSavedMessages(chat: Pick<IChatDto, 'type'> | null | undefined): boolean {
  return chat?.type === 'self';
}

/**
 * Название чата для интерфейса.
 *
 * У «Избранного» — всегда на языке интерфейса: сервер присылает название
 * по-русски для любого языка (#1075).
 */
export function getChatTitle(chat: Pick<IChatDto, 'type' | 'title'>, t: TFunction): string {
  if (isSavedMessages(chat)) return t('savedMessages.title', 'Избранное');
  return chat.title || t('untitledChat', 'Без названия');
}
