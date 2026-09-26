import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router-dom';
import { chatKeys, clearDraft, type IChatDto } from '@/entities/chat';
import { services } from '@/services';
import { describeApiError } from '@/shared/api';
import { REACT_ROUTES } from '@/shared/config';
import { showToast } from '@/shared/ui';
import { LeaveGroupDialog } from '../ui/LeaveGroupDialog';

interface Options {
  /** Диалог закрыт: вышли, удалили группу, отменили или не вышло. */
  onDone?: () => void;
}

type TLeaveStep = { kind: 'leave'; successorId: string | null } | { kind: 'delete' };

/**
 * Выход из группы для любого места, где он нужен (#90): сведения о группе,
 * меню строки чата. Диалог место вызова кладёт к себе — оно же решает, что
 * делать со своим меню, пока диалог открыт.
 *
 * Роль берётся из чата, но ей не доверяем до конца: если сервер ответил,
 * что сначала нужно передать права, диалог сам переходит к выбору
 * преемника.
 */
export function useLeaveGroupFlow({ onDone }: Options = {}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openChat = useMatch(REACT_ROUTES.CHAT_BY_ID)?.params.chatId;
  const [target, setTarget] = useState<IChatDto | null>(null);
  const [ownerDetected, setOwnerDetected] = useState(false);

  const finish = () => {
    setTarget(null);
    setOwnerDetected(false);
    onDone?.();
  };

  /* Сначала уводим с экрана чата, потом чистим кеш: иначе открытый чат
     успеет перезапросить себя и получит отказ — вы уже не участник. */
  const forget = async (chatId: string) => {
    if (openChat === chatId) navigate(REACT_ROUTES.CHATS);
    clearDraft(chatId);
    queryClient.removeQueries({ queryKey: chatKeys.detail(chatId) });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: chatKeys.list() }),
      queryClient.invalidateQueries({ queryKey: chatKeys.archived() }),
    ]);
  };

  const mutation = useMutation({
    mutationFn: async ({ chatId, step }: { chatId: string; step: TLeaveStep }) => {
      if (step.kind === 'delete') {
        await services.chatService.deleteChat(chatId);
        return;
      }
      if (step.successorId) {
        await services.chatService.transferOwnership(chatId, step.successorId);
      }
      await services.chatService.leaveChat(chatId);
    },
    onSuccess: async (_, { chatId }) => {
      await forget(chatId);
      finish();
    },
    onError: (error: { code?: string; message?: string }, { chatId, step }) => {
      if (error.code === 'ownership_transfer_required' && step.kind === 'leave') {
        setOwnerDetected(true);
        return;
      }
      // Передача могла пройти, а выход — нет: роли уже другие.
      void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      showToast(
        'error',
        describeApiError(
          error,
          t,
          step.kind === 'delete'
            ? t('toast.chatDeleteFailed', 'Не удалось удалить чат, попробуйте ещё раз')
            : t('toast.leaveChatFailed', 'Не удалось покинуть чат')
        )
      );
      finish();
    },
  });

  const run = (step: TLeaveStep) => {
    if (target) mutation.mutate({ chatId: target.id, step });
  };

  return {
    isConfirming: target !== null,
    requestLeave: (chat: IChatDto) => setTarget(chat),
    dialog: (
      <LeaveGroupDialog
        chat={target}
        confirming={mutation.isPending}
        needsSuccessor={target?.role === 'owner' || ownerDetected}
        onCancel={finish}
        onDelete={() => run({ kind: 'delete' })}
        onLeave={(successorId) => run({ kind: 'leave', successorId })}
      />
    ),
  };
}
