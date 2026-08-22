import { useChatStore, useProfileStore } from '@/store';
import type { IMessageDto, TMessagesList } from '@/types';
import { memo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageBubble } from '../components';
import { ThreadSkeleton } from './Skeletons/ThreadSkeleton';
import { ThreadState } from './ThreadState';

interface Props {
  messages: TMessagesList;
  isLoading: boolean;
  error: string;
  setOpenedImage: Dispatch<SetStateAction<string | null>>;
  toggleMessageSelection: (message: IMessageDto) => void;
  messagesRef?: RefObject<HTMLElement | null>;
  bottomRef?: RefObject<HTMLDivElement | null>;
}

export const MessagesList = memo(
  ({
    messages,
    error,
    isLoading,
    setOpenedImage,
    toggleMessageSelection,
    bottomRef,
    messagesRef,
  }: Props) => {
    const { t } = useTranslation();
    const user = useProfileStore((state) => state.user);
    const translations = useChatStore((state) => state.translations);

    return (
      <section className="thread-messages styled-scrollbar" aria-busy={isLoading} ref={messagesRef}>
        {isLoading && <ThreadSkeleton />}
        {!isLoading && error && messages.length === 0 && (
          <ThreadState message={error} title={t('loadingError', 'Ошибка загрузки')} />
        )}
        {!isLoading && !error && messages.length === 0 && (
          <ThreadState
            message={t('emptyThreadDescription', 'Напишите первое сообщение в этом чате.')}
            title={t('emptyThread', 'Сообщений пока нет')}
          />
        )}
        {user &&
          messages.map((message) => (
            <MessageBubble
              currentUserId={user.id}
              key={message.id}
              message={message}
              translations={translations}
              onOpenImage={setOpenedImage}
              onSelection={toggleMessageSelection}
            />
          ))}
        <div ref={bottomRef} />
      </section>
    );
  }
);
