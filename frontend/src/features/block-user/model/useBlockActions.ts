import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { chatKeys, type IChatDto } from '@/entities/chat';
import { userKeys } from '@/entities/user';
import { services } from '@/services/serviceContainer';

/**
 * Блокировка и её снятие из интерфейса (#727).
 *
 * После действия перечитывается всё, что от него зависит: список
 * заблокированных, профиль, список чатов и личный чат с этим человеком —
 * в нём поле ввода, кнопки звонка и статус (#760, #791). Событие
 * user_blocked сервер пришлёт и само, но на этом устройстве ждать его
 * незачем.
 */
export function refreshAfterBlockChange(queryClient: QueryClient, userId: string): void {
  void queryClient.invalidateQueries({ queryKey: userKeys.blocked(), exact: true });
  void queryClient.invalidateQueries({ queryKey: userKeys.profile(userId), exact: true });
  void queryClient.invalidateQueries({ queryKey: chatKeys.list(), exact: true });
  void queryClient.invalidateQueries({ queryKey: chatKeys.archived(), exact: true });
  void queryClient.invalidateQueries({
    queryKey: chatKeys.all,
    predicate: (query) => {
      const chat = query.state.data as IChatDto | undefined;
      return query.queryKey.length === 2 && chat?.type === 'private' && chat.peerId === userId;
    },
  });
}

/** Уже заблокирован — для человека это успех, а не ошибка. */
function isAlreadyBlocked(error: unknown): boolean {
  return (error as { code?: string })?.code === 'already_blocked';
}

export function useBlockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      try {
        await services.userService.blockUser(userId);
      } catch (error) {
        if (!isAlreadyBlocked(error)) throw error;
      }
    },
    onSuccess: (_result, userId) => refreshAfterBlockChange(queryClient, userId),
  });
}

export function useUnblockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => services.userService.unblockUser(userId),
    onSuccess: (_result, userId) => refreshAfterBlockChange(queryClient, userId),
  });
}
