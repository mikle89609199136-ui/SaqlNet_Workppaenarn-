import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { IChatDto } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { describeApiError } from '@/shared/api';
import { Button, Icon, showToast } from '@/shared/ui';
import { services } from '@/services/serviceContainer';
import type { IMessageDto } from '@/types';
import { BlockUserButton } from './BlockUserButton';

/**
 * Плашка в новом чате от незнакомого (#465), как в Telegram.
 *
 * Жёсткого запрета «писать могут только знакомые» нет: контактов в
 * приложении нет, и любое определение «незнакомого» отрезало бы людей без
 * общих групп. Вместо этого — быстро отбиться: заблокировать (#760, #727)
 * или пожаловаться.
 *
 * Видна в личном чате, который начал собеседник, пока вы ему не ответили,
 * не заблокировали его и не закрыли плашку. Если история загружена не
 * вся (hasOlder), чат не новый — плашки нет.
 */
interface Props {
  chat: IChatDto;
  messages: IMessageDto[];
  hasOlder: boolean;
}

const DISMISSED_KEY = (chatId: string) => `craneapp_new_chat_banner_dismissed:${chatId}`;

function readDismissed(chatId: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY(chatId)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(chatId: string) {
  try {
    localStorage.setItem(DISMISSED_KEY(chatId), '1');
  } catch {
    /* приватный режим — плашка просто вернётся после перезагрузки */
  }
}

export function NewChatBanner({ chat, messages, hasOlder }: Props) {
  const { t } = useTranslation();
  const me = useProfileStore((state) => state.user?.id);
  const [dismissed, setDismissed] = useState(() => readDismissed(chat.id));
  const report = useMutation({
    mutationFn: () =>
      services.adminService.createReport({
        targetType: 'user',
        targetId: chat.peerId,
        reason: 'spam',
      }),
    onSuccess: () => showToast('success', t('reportSent', 'Жалоба отправлена')),
    onError: (error) =>
      showToast(
        'error',
        describeApiError(
          error as { code?: string },
          t,
          t('reportFailed', 'Не удалось отправить жалобу')
        )
      ),
  });

  const peerId = chat.peerId;
  const isNewFromStranger =
    chat.type === 'private' &&
    Boolean(peerId && me) &&
    chat.ownerId === peerId &&
    !hasOlder &&
    messages.some((message) => message.senderId === peerId) &&
    !messages.some((message) => message.senderId === me);

  if (!isNewFromStranger || chat.isPeerBlocked || chat.isBlockedByPeer || dismissed) return null;

  return (
    <section
      aria-label={t('newChatBanner.label', 'Новый собеседник')}
      className="mx-3 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-bubble border border-line bg-sheet px-4 py-3"
    >
      <p className="text-caption min-w-0 flex-1 basis-60 text-ink-2">
        {t(
          'newChatBanner.text',
          'Этот человек написал вам первым. Если вы его не знаете, можно заблокировать или пожаловаться.'
        )}
      </p>
      <div className="flex items-center gap-2">
        <BlockUserButton name={chat.title} userId={peerId ?? ''} />
        <Button
          disabled={report.isPending || report.isSuccess}
          onClick={() => report.mutate()}
          variant="secondary"
        >
          {report.isSuccess
            ? t('reportSentShort', 'Жалоба отправлена')
            : t('report', 'Пожаловаться')}
        </Button>
        <button
          aria-label={t('newChatBanner.dismiss', 'Скрыть')}
          className="rounded-control p-1.5 text-ink-3 transition-colors duration-fast hover:bg-sheet-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          onClick={() => {
            writeDismissed(chat.id);
            setDismissed(true);
          }}
          type="button"
        >
          <Icon name="cross" size="sm" />
        </button>
      </div>
    </section>
  );
}
