import { infiniteQueryOptions } from '@tanstack/react-query';
import { chatKeys } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import type { TSharedKind } from './types';

/**
 * Размер страницы общего (#842). Сетка медиа расшифровывает полные фото —
 * страница небольшая; текст лёгкий, и ссылки в нём редки — страница
 * крупнее, чтобы «Показать ещё» нажимать реже.
 */
export const SHARED_PAGE_SIZE: Record<TSharedKind, number> = { media: 24, files: 30, text: 60 };

/** Общее в переписке по виду — вкладки профиля (#842), от новых к старым. */
export function sharedMessagesQuery(chatId: string, kind: TSharedKind) {
  return infiniteQueryOptions({
    queryKey: chatKeys.shared(chatId, kind),
    queryFn: ({ pageParam }) =>
      services.messageService.fetchSharedPage(
        chatId,
        kind,
        pageParam || undefined,
        SHARED_PAGE_SIZE[kind]
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30 * 1000,
    enabled: Boolean(chatId),
  });
}
