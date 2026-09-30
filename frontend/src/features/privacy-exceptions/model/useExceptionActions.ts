import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { chatKeys, type IChatDto } from '@/entities/chat';
import { userKeys, type TPrivacyExceptionMode, type TPrivacyRule } from '@/entities/user';
import { services } from '@/services/serviceContainer';

interface ExceptionTarget {
  rule: TPrivacyRule;
  userId: string;
}

/**
 * После изменения исключений перечитывается их список и данные личных
 * чатов: из-за взаимности (#791) исключение на «Последнюю активность»
 * меняет и то, что вы видите у этого человека.
 */
function refresh(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: userKeys.privacyExceptions(), exact: true });
  void queryClient.invalidateQueries({ queryKey: chatKeys.list(), exact: true });
  void queryClient.invalidateQueries({ queryKey: chatKeys.archived(), exact: true });
  void queryClient.invalidateQueries({
    queryKey: chatKeys.all,
    predicate: (query) =>
      query.queryKey.length === 2 && (query.state.data as IChatDto | undefined)?.type === 'private',
  });
}

/** Добавить в «Всегда» / «Никогда» или перевести из одного в другой (#786). */
export function useSetPrivacyException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rule, userId, mode }: ExceptionTarget & { mode: TPrivacyExceptionMode }) =>
      services.userService.setPrivacyException(rule, userId, mode),
    onSuccess: () => refresh(queryClient),
  });
}

export function useRemovePrivacyException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rule, userId }: ExceptionTarget) =>
      services.userService.removePrivacyException(rule, userId),
    onSuccess: () => refresh(queryClient),
  });
}
