import { useNavigate } from "react-router-dom";
import { useChatsStore } from "../../store/chats";

import { useDebounce } from "../../hooks/useDebounce";

import { useMemo, useRef, useState } from "react";
import services from "../../../application/services/serviceContainer";
import { useClickOutside } from "../../hooks/useClickOutside";
import { Identicon } from "../common/Identicon";

const XIcon = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
};

const SearchIcon = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </svg>
  );
};

export const ForwardChatMessagesModal = ({
  messages,
  onClose,
  setSelectedMessages,
  setSelectionMode,
  t,
}) => {
  const chats = useChatsStore((state) => state.chats);

  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [isForwarding, setForwarding] = useState(false);
  const modalRef = useRef(null);

  const debounceSearch = useDebounce(search);

  useClickOutside(modalRef, onClose);

  const filteredChats = useMemo(() => {
    if (!debounceSearch) return chats;

    return chats.filter((chat) => {
      const title = chat.name || "";

      return title.toLowerCase().includes(debounceSearch);
    });
  }, [chats, debounceSearch]);

  const handleForward = async (e) => {
    const target = e.target;
    const button = target.closest("button");

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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="forward-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="forward-modal__header">
          <h2 className="forward-modal__header-title">
            {t("forward", "Переслать...")}
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="button forward-modal__close"
          >
            <XIcon />
          </button>
        </header>

        <div className="forward-modal__body">
          <div className="forward-modal__wrapper">
            <label className="forward-modal__search">
              <SearchIcon className="forward-modal__search-icon opacity-70" />
              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value.trim().toLowerCase())
                }
                placeholder={t("chatSearching", "Поиск чата...")}
                className="forward-modal__search-field"
              />
            </label>
          </div>

          <ul className="forward-modal__list" onClick={handleForward}>
            {filteredChats.length === 0 ? (
              <li className="forward-modal__empty">
                {t("chatsNotFound", "Чаты не найдены")}
              </li>
            ) : (
              filteredChats.map((chat) => {
                const title = chat.name || "Без названия";

                return (
                  <li className="w-full" key={chat.id}>
                    <button
                      type="button"
                      data-chatid={chat.id}
                      className="forward-modal__chat"
                    >
                      <div className="forward-chat__avatar">
                        {chat.peerId ? (
                          <Identicon userId={chat.peerId} size={48} />
                        ) : (
                          title.slice(0, 1).toUpperCase()
                        )}
                      </div>

                      <div className="forward-chat__content">
                        <div className="forward-chat__title">{title}</div>

                        {chat.lastMessage?.content && (
                          <div className="forward-chat__preview">
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

        <footer className="forward-modal__footer">
          <button type="button" onClick={onClose} className="button">
            {t("cancel", "Отмена")}
          </button>
        </footer>
      </div>
    </div>
  );
};
