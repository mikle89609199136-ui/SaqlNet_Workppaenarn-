import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { blockedUsersQuery } from '@/entities/user';
import { describeApiError } from '@/shared/api';
import { Button, ConfirmDialog, showToast } from '@/shared/ui';
import { useBlockUser, useUnblockUser } from '../model/useBlockActions';

interface Props {
  userId: string;
  name: string;
}

/**
 * «Заблокировать» / «Разблокировать» в профиле (#727). Блокировка — с
 * подтверждением: она обрывает переписку и звонки; снятие — сразу.
 */
export function BlockUserButton({ userId, name }: Props) {
  const { t } = useTranslation();
  const blocked = useQuery(blockedUsersQuery());
  const block = useBlockUser();
  const unblock = useUnblockUser();
  const [asked, setAsked] = useState(false);

  const isBlocked = Boolean(blocked.data?.some((user) => user.id === userId));
  const fail = (fallback: string) => (error: unknown) =>
    showToast('error', describeApiError(error as { code?: string }, t, fallback));

  if (isBlocked) {
    return (
      <Button
        disabled={unblock.isPending}
        onClick={() =>
          unblock.mutate(userId, { onError: fail(t('unblockFailed', 'Не удалось разблокировать')) })
        }
        variant="secondary"
      >
        {t('unblock', 'Разблокировать')}
      </Button>
    );
  }

  return (
    <>
      <Button disabled={blocked.isPending} onClick={() => setAsked(true)} variant="danger">
        {t('block', 'Заблокировать')}
      </Button>
      <ConfirmDialog
        confirmLabel={t('block', 'Заблокировать')}
        confirming={block.isPending}
        danger
        onCancel={() => setAsked(false)}
        onConfirm={() =>
          block.mutate(userId, {
            onSuccess: () => setAsked(false),
            onError: (error) => {
              setAsked(false);
              fail(t('blockFailed', 'Не удалось заблокировать'))(error);
            },
          })
        }
        open={asked}
        title={t('blockConfirmTitle', { name, defaultValue: 'Заблокировать {{name}}?' })}
      >
        {t(
          'blockConfirmText',
          'Этот человек не сможет писать вам и звонить. Разблокировать можно в его профиле или в «Настройки → Конфиденциальность → Чёрный список».'
        )}
      </ConfirmDialog>
    </>
  );
}
