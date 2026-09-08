import { describeApiError } from '@/api';
import { chatKeys } from '@/queries/keys';
import { services } from '@/services/serviceContainer';
import type { IChatDto } from '@/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useToasts } from './useToasts';

/**
 * Сколько чатов можно держать закреплёнными.
 *
 * Ограничение придумано не сервером — он берёт любое количество. Смысл в
 * другом: закреплённые занимают верх списка, и когда их два десятка,
 * закрепление перестаёт что-либо значить.
 */
export const MAX_PINNED_CHATS = 5;

/**
 * Действия над чатом из списка: закрепить, убрать в архив.
 *
 * Оба списка сбрасываются вместе: чат уходит из одного и появляется в
 * другом, и обновить только тот, где он был, значит показать его в обоих
 * сразу или ни в одном.
 */
export function useChatActions() {
  const queryClient = useQueryClient();
  const { showToast } = useToasts();
  const { t } = useTranslation();

  const refreshBothLists = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: chatKeys.list() }),
        queryClient.invalidateQueries({ queryKey: chatKeys.archived() }),
      ]),
    [queryClient]
  );

  const reportFailure = useCallback(
    (error: Error) =>
      showToast('error', describeApiError(error, t, t('actionFailed', 'Не получилось'))),
    [showToast, t]
  );

  const pinMutation = useMutation({
    mutationFn: ({ chatId, pinned }: { chatId: string; pinned: boolean }) =>
      pinned ? services.chatService.unpinChat(chatId) : services.chatService.pinChat(chatId),
    onSuccess: refreshBothLists,
    onError: reportFailure,
  });

  const archiveMutation = useMutation({
    mutationFn: ({ chatId, archived }: { chatId: string; archived: boolean }) =>
      archived
        ? services.chatService.unarchiveChat(chatId)
        : services.chatService.archiveChat(chatId),
    onSuccess: refreshBothLists,
    onError: reportFailure,
  });

  const togglePin = useCallback(
    (chat: IChatDto, pinnedCount: number) => {
      if (!chat.isPinned && pinnedCount >= MAX_PINNED_CHATS) {
        showToast(
          'info',
          t('pinnedLimitReached', `Закрепить можно не больше ${MAX_PINNED_CHATS} чатов`)
        );
        return;
      }

      pinMutation.mutate({ chatId: chat.id, pinned: chat.isPinned });
    },
    [pinMutation, showToast, t]
  );

  const toggleArchive = useCallback(
    (chat: IChatDto) => archiveMutation.mutate({ chatId: chat.id, archived: chat.isArchived }),
    [archiveMutation]
  );

  return {
    togglePin,
    toggleArchive,
    isPending: pinMutation.isPending || archiveMutation.isPending,
  };
}
