import { useTranslation } from 'react-i18next';
import { useUnblockUser } from '@/features/block-user';
import { describeApiError } from '@/shared/api';
import { Button, showToast } from '@/shared/ui';
import type { IChatDto } from '@/types';
import { ComposerForm } from './ComposerForm';

/**
 * Вместо поля ввода в личном чате с блокировкой (#760).
 *
 * Заблокировали вас — писать и звонить нельзя, сервер ответит
 * blocked_by_user. Заблокировали вы — написать можно после разблокировки,
 * как в Telegram: кнопка прямо здесь. Флаги считает сервер; разблокировка
 * перечитывает чат, профиль и чёрный список (#727), и поле ввода
 * возвращается.
 */
export function BlockedComposer({ chat }: { chat: IChatDto }) {
  const { t } = useTranslation();
  const unblock = useUnblockUser();

  const handleUnblock = () =>
    unblock.mutate(chat.peerId ?? '', {
      onError: (error) =>
        showToast(
          'error',
          describeApiError(
            error as { code?: string },
            t,
            t('unblockFailed', 'Не удалось разблокировать')
          )
        ),
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
            <Button disabled={unblock.isPending} onClick={handleUnblock} size="sm">
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
