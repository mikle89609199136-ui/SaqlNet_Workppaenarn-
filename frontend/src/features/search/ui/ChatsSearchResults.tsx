import { Avatar, Spinner } from '@/shared/ui';
import { useStartPrivateChat } from '@/features/chat-actions';
import { cn } from '@/shared/lib';
import type { IChatDto, ISearchUserDto } from '@/types';
import { useTranslation } from 'react-i18next';
import { ChatListItem, chatRowStyles } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';

interface Props {
  chats: IChatDto[];
  people: ISearchUserDto[];
  isLoadingPeople: boolean;
  isEmpty: boolean;
}

function SectionTitle({ children }: { children: string }) {
  return (
    /* Заголовок раздела — стиль label дизайн-системы, как над строками
       списка (#819). */
    <h2 className="px-3 pt-3 pb-1.5 text-meta font-semibold tracking-[0.04em] text-ink-3 uppercase">
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
  const me = useProfileStore((state) => state.user?.id);

  return (
    <>
      {chats.length > 0 && (
        <section className="flex flex-col gap-0.5">
          <SectionTitle>{t('chats', 'Чаты')}</SectionTitle>
          {chats.map((chat) => (
            <ChatListItem chat={chat} currentUserId={me} key={chat.id} />
          ))}
        </section>
      )}

      {(people.length > 0 || isLoadingPeople) && (
        <section className="flex flex-col gap-0.5">
          <SectionTitle>{t('people', 'Люди')}</SectionTitle>

          {isLoadingPeople && people.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-3 text-ui text-ink-3">
              <Spinner size="sm" />
              <span>{t('searching', 'Ищем...')}</span>
            </div>
          )}

          {people.map((user) => {
            const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;

            return (
              <button
                className={cn(chatRowStyles, 'w-full text-left disabled:opacity-50')}
                disabled={startChat.isPending}
                key={user.id}
                onClick={() => startChat.mutate(user.id)}
                type="button"
              >
                <Avatar id={user.id} name={name} size="lg" src={user.avatarUrl} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.75">
                  <span className="truncate text-body font-semibold text-ink">{name}</span>
                  <span className="truncate text-ui text-ink-2">@{user.username}</span>
                </div>
              </button>
            );
          })}
        </section>
      )}

      {isEmpty && (
        <p className="px-5 py-8 text-center text-ui text-ink-3">
          {t('nothingFound', 'Ничего не найдено')}
        </p>
      )}
    </>
  );
}
