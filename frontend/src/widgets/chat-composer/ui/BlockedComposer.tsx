import { useTranslation } from 'react-i18next';
import { useUnblockUser } from '@/features/block-user';
import { describeApiError } from '@/shared/api';
import { Banner, Button, showToast } from '@/shared/ui';
import type { IChatDto } from '@/types';
import { composerFooter } from './composerStyles';

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

  /* Плашка вместо поля — «нотис» из макета (#821, #826): замок,
     полужирное начало, действие справа на мягкой подложке акцента. */
  return (
    <div className={composerFooter}>
      {chat.isPeerBlocked ? (
        <Banner
          action={
            <Button
              className="bg-brand-soft"
              disabled={unblock.isPending}
              onClick={handleUnblock}
              size="sm"
              variant="accent"
            >
              {t('unblock', 'Разблокировать')}
            </Button>
          }
          icon="lock"
          tone="warn"
        >
          <b>{t('chatPeerBlocked', 'Вы заблокировали этого пользователя')}</b>
        </Banner>
      ) : (
        <Banner icon="lock" tone="warn">
          <b>{t('errors.blockedByUser', 'Этот человек ограничил переписку с вами')}</b>
        </Banner>
      )}
    </div>
  );
}
