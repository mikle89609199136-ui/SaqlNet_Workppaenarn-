import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { blockedUsersQuery } from '@/entities/user';
import { describeApiError } from '@/shared/api';
import { showToast } from '@/shared/ui';
import { BlockConfirmDialog } from '../ui/BlockConfirmDialog';
import { useBlockUser, useUnblockUser } from './useBlockActions';

interface Options {
  /**
   * Читать ли чёрный список. Не нужно там, где признак блокировки уже
   * есть в данных — в строке чата его несёт сам чат (isPeerBlocked).
   */
  withBlockedList?: boolean;
  /** Подтверждение закрыто: заблокировали, отменили или не вышло. */
  onDone?: () => void;
}

/**
 * Сценарий блокировки для любого места, где она нужна (#727): профиль,
 * меню строки чата, плашка нового чата. Блокировка — через подтверждение,
 * снятие — сразу; ошибки — сообщением. Диалог место вызова кладёт к себе:
 * оно же решает, что делать с меню, пока диалог открыт.
 */
export function useBlockFlow({ withBlockedList = true, onDone }: Options = {}) {
  const { t } = useTranslation();
  const blocked = useQuery({ ...blockedUsersQuery(), enabled: withBlockedList });
  const block = useBlockUser();
  const unblock = useUnblockUser();
  const [target, setTarget] = useState<{ userId: string; name: string } | null>(null);

  const report = (fallback: string) => (error: unknown) =>
    showToast('error', describeApiError(error as { code?: string }, t, fallback));

  const finish = () => {
    setTarget(null);
    onDone?.();
  };

  return {
    isBlocked: (userId: string) => Boolean(blocked.data?.some((user) => user.id === userId)),
    isListLoading: withBlockedList && blocked.isPending,
    isConfirming: target !== null,
    isUnblocking: unblock.isPending,
    requestBlock: (userId: string, name: string) => setTarget({ userId, name }),
    unblock: (userId: string) =>
      unblock.mutate(userId, { onError: report(t('unblockFailed', 'Не удалось разблокировать')) }),
    dialog: (
      <BlockConfirmDialog
        confirming={block.isPending}
        name={target?.name ?? ''}
        onCancel={finish}
        onConfirm={() => {
          if (!target) return;
          block.mutate(target.userId, {
            onSuccess: finish,
            onError: (error) => {
              report(t('blockFailed', 'Не удалось заблокировать'))(error);
              finish();
            },
          });
        }}
        open={target !== null}
      />
    ),
  };
}
