import { showToast } from '@/shared/ui';
import { describeApiError } from '@/shared/api';
import { chatKeys } from '@/entities/chat';
import { services } from '@/services/serviceContainer';
import type { IChatDto } from '@/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Сколько чатов можно держать закреплёнными.
 *
 * Ограничение придумано не сервером — он берёт любое количество. Смысл в
 * другом: закреплённые занимают верх списка, и когда их два десятка,
 * закрепление перестаёт что-либо значить.
 */
export const MAX_PINNED_CHATS = 5;

/**
 * Снять счётчик непрочитанных у одного чата.
 *
 * Список и архив — два запроса с одинаковой формой ответа, и чат может
 * лежать в любом из них, поэтому обнуляется в обоих.
 */
function clearUnread(chats: IChatDto[] | undefined, chatId: string): IChatDto[] | undefined {
  return chats?.map((chat) => (chat.id === chatId ? { ...chat, unreadCount: 0 } : chat));
}

/**
 * Действия над чатом из списка: закрепить, убрать в архив.
 *
 * Оба списка сбрасываются вместе: чат уходит из одного и появляется в
 * другом, и обновить только тот, где он был, значит показать его в обоих
 * сразу или ни в одном.
 */
export function useChatActions() {
  const queryClient = useQueryClient();
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

  /**
   * Отметить чат прочитанным.
   *
   * Счётчик гасится сразу, не дожидаясь сервера: иначе бейдж мигает прежним
   * числом до конца запроса, а при медленной связи это заметно. Значение
   * запоминается и возвращается, если сервер отказал — без этого счётчик
   * остался бы нулём при непрочитанных сообщениях.
   *
   * Перезапросы списка отменяются: начатый раньше, он вернул бы старое
   * значение поверх нового.
   */
  const readMutation = useMutation({
    mutationFn: (chatId: string) => services.chatService.markChatRead(chatId),
    onMutate: async (chatId: string) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: chatKeys.list() }),
        queryClient.cancelQueries({ queryKey: chatKeys.archived() }),
      ]);

      const previous = {
        list: queryClient.getQueryData<IChatDto[]>(chatKeys.list()),
        archived: queryClient.getQueryData<IChatDto[]>(chatKeys.archived()),
      };

      queryClient.setQueryData<IChatDto[]>(chatKeys.list(), (chats) => clearUnread(chats, chatId));
      queryClient.setQueryData<IChatDto[]>(chatKeys.archived(), (chats) =>
        clearUnread(chats, chatId)
      );

      return previous;
    },
    onError: (error: Error, _chatId, previous) => {
      queryClient.setQueryData(chatKeys.list(), previous?.list);
      queryClient.setQueryData(chatKeys.archived(), previous?.archived);
      reportFailure(error);
    },
    onSuccess: refreshBothLists,
  });

  const markRead = useCallback((chat: IChatDto) => readMutation.mutate(chat.id), [readMutation]);

  return {
    togglePin,
    toggleArchive,
    markRead,
    isPending: pinMutation.isPending || archiveMutation.isPending || readMutation.isPending,
  };
}
