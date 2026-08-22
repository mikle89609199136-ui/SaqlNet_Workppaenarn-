import { useDebounce } from '@/hooks';
import { services } from '@/services';
import { useChatsStore } from '@/store';
import type { TMessagesList } from '@/types';
import { useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon, Modal } from '../ui';
import { Identicon } from '../ui/Identicon';

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
  const chats = useChatsStore((state) => state.chats);

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
        await services.messageService.forwardMessage(message.id, chatId);
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
    <Modal className='max-w-4/5 md:max-w-1/5' onClose={onClose}>
      <header className="flex justify-between px-6">
        <h2 className="text-xl w-full text-left">{t('forward', 'Переслать...')}</h2>

        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer transition-colors text-[#2b77e7] hover:text-[rgba(43,119,231,.9)] shrink-0"
        >
          <Icon name='cross' />
        </button>
      </header>

      <div className="flex flex-col mb-auto">
        <div className="px-6 border-b border-border">
          <label className="flex gap-x-2 items-center relative">
            <Icon name='search' className="size-5 shrink-0 absolute top-1/2 -translate-y-1/2 opacity-70" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value.trim().toLowerCase())}
              placeholder={t('chatSearching', 'Поиск чата...')}
              className="py-3 text-lg pr-1 pl-7 w-full outline-none rounded-xl"
            />
          </label>
        </div>

        <ul
          className="flex flex-col overflow-y-auto overflow-x-hidden h-full styled-scrollbar"
          onClick={handleForward}
        >
          {filteredChats.length === 0 ? (
            <li className="mx-auto py-2">{t('chatsNotFound', 'Чаты не найдены')}</li>
          ) : (
            filteredChats.map((chat) => {
              const title = chat.title || 'Без названия';

              return (
                <li className="w-full" key={chat.id}>
                  <button
                    type="button"
                    data-chatid={chat.id}
                    className="w-full flex gap-x-2 cursor-pointer transition-colors hover:bg-panel px-6 py-3"
                  >
                    <div className="chat-avatar shrink-0">
                      {chat.avatarUrl && <img src={chat.avatarUrl} alt="" />}
                      {!chat.avatarUrl && chat.peerId ? (
                        <Identicon userId={chat.peerId} size={48} />
                      ) : (
                        title.slice(0, 1).toUpperCase()
                      )}
                    </div>

                    <div className="flex flex-col gap-y-1 w-full">
                      <div className="text-left w-full">{title}</div>

                      {chat.lastMessage?.content && (
                        <div className="line-clamp-1 truncate min-w-0 max-w-8/10 text-left">
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

      <footer className="px-4 flex justify-end border-t border-border w-full py-2">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer transition-colors text-[#2b77e7] hover:text-[rgba(43,119,231,.9)] hover:bg-panel px-4 py-2 rounded-lg"
        >
          {t('cancel', 'Отмена')}
        </button>
      </footer>
    </Modal>
  );
};
