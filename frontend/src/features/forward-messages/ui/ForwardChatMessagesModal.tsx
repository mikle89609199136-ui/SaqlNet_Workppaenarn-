import { useDebounce } from '@/shared/lib';
import { describeApiError } from '@/shared/api';
import {
  chatKeys,
  chatsQuery,
  getChatTitle,
  getLastMessageText,
  isSavedMessages,
} from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TMessagesList } from '@/types';
import { useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Icon, Modal, showToast } from '@/shared/ui';
import { useForwardStore } from '../model/forwardStore';

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
  const viewerId = useProfileStore((state) => state.user?.id);
  const { data: chats = [] } = useQuery(chatsQuery());

  const queryClient = useQueryClient();

  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [openingSaved, setOpeningSaved] = useState(false);

  const debounceSearch = useDebounce(search);

  /* «Избранное» — всегда первой строкой, даже если чата ещё нет: сервер
     заведёт его при выборе (#1075). Из общего списка оно не повторяется. */
  const savedChat = chats.find(isSavedMessages);
  const savedTitle = t('savedMessages.title', 'Избранное');
  const showSaved = !debounceSearch || savedTitle.toLowerCase().includes(debounceSearch);

  const filteredChats = useMemo(() => {
    const others = chats.filter((chat) => !isSavedMessages(chat));
    if (!debounceSearch) return others;

    return others.filter((chat) => getChatTitle(chat, t).toLowerCase().includes(debounceSearch));
  }, [chats, debounceSearch, t]);

  /* Выбор чата ничего не отправляет: пересылка ждёт в целевом чате над
     полем ввода, где к ней можно дописать комментарий или отменить её
     (#93). Прежде сообщения уходили от одного нажатия на строку списка. */
  const startForward = (chatId: string) => {
    useForwardStore.getState().start(chatId, messages);
    setSelectedMessages([]);
    setSelectionMode(false);
    onClose();
    navigate(`/chats/${chatId}`);
  };

  const handleForward = (e: MouseEvent<HTMLUListElement>) => {
    const button = (e.target as HTMLElement).closest('button');
    if (button?.dataset.saved) {
      void forwardToSaved();
      return;
    }
    const chatId = button?.dataset.chatid;
    if (chatId) startForward(chatId);
  };

  async function forwardToSaved() {
    if (savedChat) {
      startForward(savedChat.id);
      return;
    }
    if (openingSaved || !viewerId) return;

    setOpeningSaved(true);
    try {
      const chatId = await services.chatService.openSavedMessages(viewerId);
      void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      startForward(chatId);
    } catch (error) {
      // Окно остаётся открытым, пересылка не начата.
      showToast(
        'error',
        describeApiError(
          error as { code?: string; message?: string },
          t,
          t('savedMessages.openFailed', 'Не удалось открыть Избранное')
        )
      );
    } finally {
      setOpeningSaved(false);
    }
  }

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
          {showSaved && (
            <li className="w-full">
              <button
                type="button"
                data-saved="true"
                disabled={openingSaved}
                className="w-full flex gap-x-2 cursor-pointer transition-colors hover:bg-sheet-2 px-6 py-3 text-ink disabled:cursor-default disabled:opacity-60"
              >
                <Avatar icon="bookmark" name={savedTitle} size="lg" />
                <div className="flex flex-col gap-y-1 w-full">
                  <div className="text-left w-full font-medium">{savedTitle}</div>
                </div>
              </button>
            </li>
          )}

          {filteredChats.length === 0 && !showSaved ? (
            <li className="mx-auto py-2 text-ink-3">{t('chatsNotFound', 'Чаты не найдены')}</li>
          ) : (
            filteredChats.map((chat) => {
              const title = getChatTitle(chat, t);

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

                      {chat.lastMessage && (
                        <div className="line-clamp-1 truncate min-w-0 max-w-8/10 text-left text-ink-3">
                          {getLastMessageText(chat.lastMessage, t, viewerId)}
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
