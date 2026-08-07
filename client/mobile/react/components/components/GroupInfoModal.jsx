import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { STORAGE_KEYS } from "../../consts/storageKeys.js";
import { useLocalStorage } from "../../hooks/useLocalStorage.js";
import { useToasts } from "../../hooks/useToasts.js";
import services from "../../services/serviceContainer.js";
import { useChatStore } from "../../store/chat.js";
import { useChatsStore } from "../../store/chats.js";
import { Identicon } from "../ui/Identicon.jsx";

export function GroupInfoModal({ isOpen, onClose }) {
  const { showToast } = useToasts();
  const [members, setMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [isEditMode, setEditMode] = useState(false);
  const [chatName, setChatName] = useState("");
  const deleteChat = useChatsStore((state) => state.deleteChat);
  const chat = useChatStore((state) => state.chat);
  const updateChat = useChatStore((state) => state.updateChat);
  const setChat = useChatStore((state) => state.setChat);
  const navigate = useNavigate();
  const [currentUserData] = useLocalStorage(STORAGE_KEYS.USER, {});
  const { t } = useTranslation();

  useEffect(() => {
    fetchMembers();
  }, [chat]);

  useEffect(() => {
    if (chat) {
      setChatName(chat.name);
    }
  }, [chat]);

  async function fetchMembers() {
    setIsLoading(true);
    try {
      const nextMembers = await services.chatService.getMembers(chat.id);
      setMembers(nextMembers);
      const myMember = nextMembers.find((m) => m.id === currentUserData.id);

      if (myMember) {
        setCurrentUser(myMember);
      }
    } catch (err) {
      showToast("error", "Ошибка загрузки участников", "❌");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAction(action, userId, body = null) {
    try {
      if (action === "change-participant-role") {
        await services.chatService.setMemberRole(chat.id, userId, body?.role);
        setMembers((members) =>
          members.map((member) =>
            member.id === userId ? { ...member, role: body?.role } : member,
          ),
        );
        return;
      }

      if (action === "kick-participant") {
        await services.chatService.removeMember(chat.id, userId);
        setMembers((members) =>
          members.filter((member) => member.id !== userId),
        );
        return;
      }

      throw new Error("Unsupported group action");
    } catch (err) {
      showToast("error", err.message || "Ошибка выполнения действия", "❌");
    }
  }

  const handleToggleEditMode = () => {
    if (isEditMode) {
      setEditMode(false);
      setChatName(chat.name);
      return;
    }

    setEditMode(true);
  };

  const handleSaveEdited = () => {
    updateChat({ name: chatName });
    handleToggleEditMode();
  };

  const handleLeaveChat = () => {};

  const handleDeleteChat = async () => {
    try {
      const result = await deleteChat(chat.id);

      if (!result.success) throw new Error("Could not delete chat, try again");
      setChat(null);
      navigate("/chats");
    } catch (err) {
      showToast(
        "error",
        err.message || "Не удалось удалить чат, попробуйте ещё раз",
        "❌",
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="group-info-modal-overlay" onClick={onClose}>
      <div
        className="group-info-modal-content group-info-modal-content--glass-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="group-info-header">
          <div className="flex w-full items-center gap-x-2">
            <div className="group-info-header__wrapper">
              <div className="group-info-header__avatar cursor-default">
                {chat?.avatarUrl ? (
                  <img alt="" src={chat.avatarUrl} />
                ) : chat?.type === "private" && chat?.peerId ? (
                  <Identicon size={98} userId={chat.peerId} />
                ) : (
                  chat?.name.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="group-info-header__text-wrapper">
                {!isEditMode ? (
                  <h2>{chat?.name}</h2>
                ) : (
                  <label className="group-info-header__field">
                    <span className="group-info-header__field-text">
                      {t("chatName", "Название чата")}
                    </span>
                    <input
                      className="group-info-header__field-input"
                      type="text"
                      value={chatName}
                      onChange={(e) => setChatName(e.target.value)}
                    />
                  </label>
                )}
                {!isEditMode && <p>{`${members.length} Участников`}</p>}
              </div>
            </div>
            <button className="close-btn" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="group-info-header__actions-button-wrapper">
            {!isEditMode && (
              <>
                <button
                  className="action-btn w-full"
                  onClick={handleToggleEditMode}
                >
                  {t("edit", "Редактировать")}
                </button>
                <button
                  className="action-btn w-full danger"
                  onClick={handleLeaveChat}
                >
                  {t("leaveChat", "Покинуть чат")}
                </button>
                {currentUser?.role === "owner" && (
                  <button
                    className="action-btn w-full danger"
                    onClick={handleDeleteChat}
                  >
                    {t("deleteChat", "Удалить чат")}
                  </button>
                )}
              </>
            )}
            {isEditMode && (
              <>
                <button
                  className="action-btn w-full"
                  onClick={handleSaveEdited}
                >
                  {t("save", "Сохранить")}
                </button>
                <button
                  className="action-btn w-full danger"
                  onClick={handleToggleEditMode}
                >
                  {t("cancel", "Отменить")}
                </button>
              </>
            )}
          </div>
        </header>

        <div className="group-info-body">
          {isLoading ? (
            <div className="loading-state">{t("loading", "Загрузка...")}</div>
          ) : (
            <ul className="members-list">
              {members.map((member) => {
                const memberId = member.id;
                const avatarUrl = member.avatarUrl;
                return (
                  <li key={memberId} className="member-item">
                    <div className="member-avatar">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="avatar" />
                      ) : (
                        <Identicon userId={memberId} size={44} />
                      )}
                    </div>
                    <div className="member-details">
                      <span className="member-name">{member.username}</span>
                      <span className={`member-role role-${member.role}`}>
                        {member.role}
                      </span>
                    </div>

                    {/* Moderation Controls */}
                    {(currentUser?.role === "owner" ||
                      currentUser?.role === "admin") &&
                      memberId !== currentUserData.id && (
                        <div className="member-actions">
                          {currentUser?.role === "owner" && (
                            <button
                              className="action-btn"
                              onClick={() =>
                                handleAction(
                                  "change-participant-role",
                                  memberId,
                                  {
                                    role:
                                      member.role === "admin"
                                        ? "member"
                                        : "admin",
                                  },
                                )
                              }
                            >
                              {member.role === "admin"
                                ? "Снять админа"
                                : "Дать админа"}
                            </button>
                          )}
                          {member.role !== "owner" && (
                            <button
                              className="action-btn danger"
                              onClick={() =>
                                handleAction("kick-participant", memberId)
                              }
                            >
                              Кикнуть
                            </button>
                          )}
                        </div>
                      )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
