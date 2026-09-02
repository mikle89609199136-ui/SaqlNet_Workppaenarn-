import { useDebounce } from '@/hooks';
import { services } from '@/services';
import { chatsQuery } from '@/queries/chats/chatsQuery';
import { useQuery } from '@tanstack/react-query';
import type { TMessagesList } from '@/types';
import { useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Icon, Modal } from '@/components/ui';

interface Props {
  messages: TMessagesList;
  onClose: () => void;
  setSelectedMessages: (messages: TMessagesList) => void;
  setSelectionMode: (selectionMode: boolean) => void;
}

export const ForwardChatMessagesModal = ({
  messages,
  onClose,
  setSelectedMessages,
  setSelectionMode,
}: Props) => {
  const { t } = useTranslation();
  const { data: chats = [] } = useQuery(chatsQuery());

  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [isForwarding, setForwarding] = useState(false);

  const debounceSearch = useDebounce(search);

  const filteredChats = useMemo(() => {
    if (!debounceSearch) return chats;

    return chats.filter((chat) => {
      const title = chat.title || '';

      return title.toLowerCase().includes(debounceSearch);
    });
  }, [chats, debounceSearch]);

  const handleForward = async (e: MouseEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement;
    const button = target.closest('button');

    if (!button) return;

    const chatId = button.dataset.chatid;

    if (!chatId || isForwarding) return;

    try {
      setForwarding(true);
      for (const message of messages) {
        await services.messageService.forwardMessage(message, chatId);
      }

      setSelectedMessages([]);
      setSelectionMode(false);
      onClose();
      navigate(`/chats/${chatId}`);
    } finally {
      setForwarding(false);
    }
  };

  return (
    <Modal
      className="w-4/5 max-w-none bg-sheet md:w-100"
      label={t('forwardMessages', 'Переслать сообщения')}
      onClose={onClose}
    >
      <header className="flex justify-between items-center px-6 py-3">
        <h2 className="text-xl font-medium w-full text-left">{t('forward', 'Переслать...')}</h2>

        <Button
          aria-label={t('close', 'Закрыть')}
          className="shrink-0 text-ink-2 hover:text-ink"
          onClick={onClose}
          size="sm"
          variant="ghost"
        >
          <Icon name="cross" />
        </Button>
      </header>

      <div className="flex flex-col mb-auto">
        <div className="px-6 border-b border-line">
          <label className="flex gap-x-2 items-center relative">
            <Icon
              name="search"
              className="size-5 shrink-0 absolute top-1/2 -translate-y-1/2 text-ink-3"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value.trim().toLowerCase())}
              placeholder={t('chatSearching', 'Поиск чата...')}
              className="py-3 text-lg pr-1 pl-7 w-full bg-transparent outline-none rounded-xl text-ink placeholder:text-ink-3"
            />
          </label>
        </div>

        <ul
          className="flex flex-col overflow-y-auto overflow-x-hidden h-full styled-scrollbar"
          onClick={handleForward}
        >
          {filteredChats.length === 0 ? (
            <li className="mx-auto py-2 text-ink-3">{t('chatsNotFound', 'Чаты не найдены')}</li>
          ) : (
            filteredChats.map((chat) => {
              const title = chat.title || t('untitledChat', 'Без названия');

              return (
                <li className="w-full" key={chat.id}>
                  <button
                    type="button"
                    data-chatid={chat.id}
                    className="w-full flex gap-x-2 cursor-pointer transition-colors hover:bg-sheet-2 px-6 py-3 text-ink"
                  >
                    <Avatar id={chat.peerId} name={title} size="lg" src={chat.avatarUrl} />

                    <div className="flex flex-col gap-y-1 w-full">
                      <div className="text-left w-full font-medium">{title}</div>

                      {chat.lastMessage?.content && (
                        <div className="line-clamp-1 truncate min-w-0 max-w-8/10 text-left text-ink-3">
                          {chat.lastMessage.content}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <footer className="px-4 flex justify-end border-t border-line w-full py-2">
        <Button onClick={onClose} size="sm" variant="ghost">
          {t('cancel', 'Отмена')}
        </Button>
      </footer>
    </Modal>
  );
};
