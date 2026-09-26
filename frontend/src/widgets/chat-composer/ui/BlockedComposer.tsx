import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { chatKeys } from '@/entities/chat';
import { describeApiError } from '@/shared/api';
import { Button, showToast } from '@/shared/ui';
import { services } from '@/services/serviceContainer';
import type { IChatDto } from '@/types';
import { ComposerForm } from './ComposerForm';

/**
 * Вместо поля ввода в личном чате с блокировкой (#760).
 *
 * Заблокировали вас — писать и звонить нельзя, сервер ответит
 * blocked_by_user. Заблокировали вы — написать можно после разблокировки,
 * как в Telegram: кнопка прямо здесь. Флаги считает сервер; после
 * разблокировки чат перечитывается и поле ввода возвращается.
 */
export function BlockedComposer({ chat }: { chat: IChatDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const unblock = useMutation({
    mutationFn: () => services.userService.unblockUser(chat.peerId ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chat.id), exact: true });
      void queryClient.invalidateQueries({ queryKey: chatKeys.list(), exact: true });
    },
    onError: (error) => {
      showToast(
        'error',
        describeApiError(
          error as { code?: string },
          t,
          t('unblockFailed', 'Не удалось разблокировать')
        )
      );
    },
  });

  return (
    <ComposerForm onSubmit={(event) => event.preventDefault()}>
      <div
        className="flex min-h-11 items-center justify-center gap-3 px-2 text-center"
        role="status"
      >
        {chat.isPeerBlocked ? (
          <>
            <span className="text-body text-ink-2">
              {t('chatPeerBlocked', 'Вы заблокировали этого пользователя')}
            </span>
            <Button disabled={unblock.isPending} onClick={() => unblock.mutate()} size="sm">
              {t('unblock', 'Разблокировать')}
            </Button>
          </>
        ) : (
          <span className="text-body text-ink-2">
            {t('errors.blockedByUser', 'Этот человек ограничил переписку с вами')}
          </span>
        )}
      </div>
    </ComposerForm>
  );
}
