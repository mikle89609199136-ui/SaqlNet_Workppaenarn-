import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { IChatDto } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { describeApiError } from '@/shared/api';
import { cn } from '@/shared/lib';
import { Button, showToast } from '@/shared/ui';
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

  /* По макету (#826): карточка по центру ленты, заголовок, пояснение и
     три действия в ряд — опасное, нейтральное и тихое. */
  const action = 'h-9 rounded-field px-3.5 text-caption font-semibold';

  return (
    <section
      aria-label={t('newChatBanner.label', 'Новый собеседник')}
      className="mx-auto mt-3 flex w-[calc(100%-32px)] max-w-130 shrink-0 flex-col gap-2.5 rounded-bubble bg-sheet-2 px-4 py-3.5 text-center"
    >
      <h2 className="m-0 text-ui font-semibold text-ink">
        {t('newChatBanner.label', 'Новый собеседник')}
      </h2>
      <p className="m-0 text-caption leading-[1.45] text-ink-2">
        {t(
          'newChatBanner.text',
          'Вы ещё не переписывались с этим человеком. Если не знаете его — заблокируйте или пожалуйтесь.'
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <BlockUserButton className={action} name={chat.title} userId={peerId ?? ''} />
        <Button
          className={cn(action, 'bg-sheet')}
          disabled={report.isPending || report.isSuccess}
          onClick={() => report.mutate()}
          variant="secondary"
        >
          {report.isSuccess
            ? t('reportSentShort', 'Жалоба отправлена')
            : t('report', 'Пожаловаться')}
        </Button>
        <Button
          className={cn(action, 'font-normal text-ink-2')}
          onClick={() => {
            writeDismissed(chat.id);
            setDismissed(true);
          }}
          variant="ghost"
        >
          {t('newChatBanner.dismiss', 'Скрыть')}
        </Button>
      </div>
    </section>
  );
}
