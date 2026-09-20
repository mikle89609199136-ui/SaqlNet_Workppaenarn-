import { Avatar, Spinner } from '@/shared/ui';
import { useStartPrivateChat } from '@/features/chat-actions';
import { cn } from '@/shared/lib';
import type { IChatDto, ISearchUserDto } from '@/types';
import { useTranslation } from 'react-i18next';
import { ChatListItem, chatRowStyles } from '@/entities/chat';

interface Props {
  chats: IChatDto[];
  people: ISearchUserDto[];
  isLoadingPeople: boolean;
  isEmpty: boolean;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="px-4 pb-1 pt-3 text-caption font-semibold uppercase tracking-wide text-ink-3">
      {children}
    </h2>
  );
}

/**
 * Что нашлось по запросу: сначала свои чаты, затем люди.
 *
 * Порядок разделов не произвольный: свои чаты находятся мгновенно и
 * почти всегда содержат искомое, а люди приходят с сервера с задержкой.
 * Если бы они шли первыми, список подпрыгивал бы при каждом ответе.
 */
export function ChatsSearchResults({ chats, people, isLoadingPeople, isEmpty }: Props) {
  const { t } = useTranslation();
  const startChat = useStartPrivateChat();

  return (
    <>
      {chats.length > 0 && (
        <section>
          <SectionTitle>{t('chats', 'Чаты')}</SectionTitle>
          {chats.map((chat) => (
            <ChatListItem chat={chat} key={chat.id} />
          ))}
        </section>
      )}

      {(people.length > 0 || isLoadingPeople) && (
        <section>
          <SectionTitle>{t('people', 'Люди')}</SectionTitle>

          {isLoadingPeople && people.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-3 text-caption text-ink-3">
              <Spinner size="sm" />
              <span>{t('searching', 'Ищем...')}</span>
            </div>
          )}

          {people.map((user) => {
            const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;

            return (
              <button
                className={cn(chatRowStyles, 'w-full text-left disabled:opacity-42')}
                disabled={startChat.isPending}
                key={user.id}
                onClick={() => startChat.mutate(user.id)}
                type="button"
              >
                <Avatar id={user.id} name={name} size="lg" src={user.avatarUrl} />
                <div className="flex min-w-0 flex-col justify-center gap-1.5">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-base font-semibold text-ink">{name}</span>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-3 text-caption text-ink-2">
                    <span className="truncate">@{user.username}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </section>
      )}

      {isEmpty && (
        <p className="px-4 py-6 text-center text-caption text-ink-3">
          {t('nothingFound', 'Ничего не найдено')}
        </p>
      )}
    </>
  );
}
