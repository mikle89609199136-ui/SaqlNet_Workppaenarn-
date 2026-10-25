import { useProfileStore } from '@/entities/user';
import { cn } from '@/shared/lib';
import { Avatar, Button, Highlight, Icon } from '@/shared/ui';
import type { IMessageDto } from '@/types';
import { useTranslation } from 'react-i18next';
import { useMessageSearchStore } from '../model/messageSearchStore';
import { snippetAround } from '../model/searchMatches';

function useResultDate() {
  const { t, i18n } = useTranslation();
  return (value: IMessageDto['createdAt']) => {
    const date = new Date(value);
    const isToday = date.toDateString() === new Date().toDateString();
    return isToday
      ? `${t('today', 'Сегодня')}, ${date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}`
      : date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  };
}

export function MessageSearchResults() {
  const { t } = useTranslation();
  const me = useProfileStore((state) => state.user?.id);
  const query = useMessageSearchStore((state) => state.query);
  const results = useMessageSearchStore((state) => state.results);
  const currentIndex = useMessageSearchStore((state) => state.currentIndex);
  const select = useMessageSearchStore((state) => state.select);
  const close = useMessageSearchStore((state) => state.close);
  const formatDate = useResultDate();

  return (
    <section
      aria-label={t('messageSearch.found', 'Найдено в чате')}
      className="flex h-full flex-col gap-3 overflow-hidden p-3"
    >
      <header className="flex items-center gap-2 pl-1">
        <h2 className="flex-1 text-subtitle font-semibold text-ink">
          {t('messageSearch.found', 'Найдено в чате')}
        </h2>
        <span className="text-caption text-ink-3 tabular-nums">{results.length}</span>
        <Button
          aria-label={t('messageSearch.close', 'Закрыть поиск')}
          iconOnly
          onClick={close}
          size="sm"
          variant="ghost"
        >
          <Icon className="size-4.5" name="cross" />
        </Button>
      </header>

      <p className="flex gap-2 rounded-button bg-brand-soft px-3 py-2.5 text-caption leading-[1.4] text-ink-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-brand" name="lock" />
        {t(
          'messageSearch.privacy',
          'Ищем на этом устройстве по уже расшифрованным сообщениям. Сервер не видит ни переписку, ни запрос.'
        )}
      </p>

      <ol className="styled-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {results.map((message, index) => {
          const mine = message.senderId === me;
          const name = message.senderName || message.senderFirstName;
          const author = mine ? t('you', 'Вы') : name;
          return (
            <li key={message.id}>
              <button
                aria-current={index === currentIndex ? 'true' : undefined}
                className={cn(
                  'flex w-full cursor-pointer gap-2.5 rounded-button px-2 py-2 text-left transition-colors duration-fast',
                  'hover:layer-hover aria-[current=true]:bg-sheet-2',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand'
                )}
                onClick={() => select(index)}
                type="button"
              >
                <Avatar id={message.senderId} name={name} size="sm" src={message.senderAvatar} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-ui font-semibold text-ink">
                      {author}
                    </span>
                    <time className="shrink-0 text-meta text-ink-3">
                      {formatDate(message.createdAt)}
                    </time>
                  </span>
                  <span className="line-clamp-2 text-caption text-ink-2">
                    <Highlight
                      current={index === currentIndex}
                      query={query}
                      text={snippetAround(message.content, query)}
                    />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
