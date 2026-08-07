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
import {cn} from "../../utils/cn";


const roleStyles = {
    owner: "text-[#ffa500] bg-[#ffa500]/20 border-[#ffa500]/30",
    admin: "text-[#00bfff] bg-[#00bfff]/20 border-[#00bfff]/30",
    member: "text-[#aaa] bg-white/10 border-transparent",
};

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
    <div className="fixed inset-0 z-[1000] flex justify-center items-center bg-black/40 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]" onClick={onClose}>
      <div
        className="w-full flex flex-col overflow-hidden h-full max-h-screen max-w-[500px] bg-[#141416]/85 border border-solid border-white/10 border-b-0 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] animate-[slideUp_0.3s_cubic-bezier(0.2,0.8,0.2,1)] md:max-h-[85vh] md:rounded-3xl group-info-modal-content--glass-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-col gap-y-5 py-5 px-6 border-b border-solid border-white/5">
          <div className="flex w-full items-center gap-x-2">
            <div className="flex gap-x-4 items-center w-full">
              <div className="relative size-16 rounded-full flex items-center justify-center bg-[#2b77e7] text-white font-bold text-2xl shrink-0 border-0 p-0 cursor-pointer cursor-default">
                {chat?.avatarUrl ? (
                  <img className="w-full h-full block rounded-[inherit] object-cover" alt="" src={chat.avatarUrl} />
                ) : chat?.type === "private" && chat?.peerId ? (
                  <Identicon size={98} userId={chat.peerId} />
                ) : (
                  chat?.name.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="flex flex-col  w-full">
                {!isEditMode ? (
                  <h2 className="text-[1.2rem] font-semibold m-0 bg-gradient-to-br from-white to-[#aaa] bg-clip-text text-transparent" >{chat?.name}</h2>
                ) : (
                  <label className="flex flex-col border-b border-border w-full focus-within:border-b-[#2b77e7] transition-colors">
                    <span className="group-info-header__field-text">
                      {t("chatName", "Название чата")}
                    </span>
                    <input
                      className="pb-1 outline-none border-0 w-full"
                      type="text"
                      value={chatName}
                      onChange={(e) => setChatName(e.target.value)}
                    />
                  </label>
                )}
                {!isEditMode && <p>{`${members.length} Участников`}</p>}
              </div>
            </div>
            <button className="w-8 h-8 rounded-full text-white text-base cursor-pointer flex items-center justify-center transition-colors duration-200 border-none bg-white/10 hover:bg-white/20" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="flex justify-between items-center gap-x-4">
            {!isEditMode && (
              <>
                <button
                    className="w-full text-[#ddd] rounded-lg text-[0.8rem] cursor-pointer transition-all duration-200 font-medium bg-white/10 border border-solid border-white/5 py-1.5 px-3 hover:text-white hover:bg-white/20"
                  onClick={handleToggleEditMode}
                >
                  {t("edit", "Редактировать")}
                </button>
                <button
                    className="w-full rounded-lg text-[0.8rem] cursor-pointer transition-all duration-200 font-medium border border-solid text-[#ff4444] bg-[#ff3232]/10 border-[#ff3232]/20 hover:text-[#ff6666] hover:bg-[#ff3232]/20"
                  onClick={handleLeaveChat}
                >
                  {t("leaveChat", "Покинуть чат")}
                </button>
                {currentUser?.role === "owner" && (
                  <button
                      className="w-full rounded-lg text-[0.8rem] cursor-pointer transition-all duration-200 font-medium border border-solid text-[#ff4444] bg-[#ff3232]/10 border-[#ff3232]/20 hover:text-[#ff6666] hover:bg-[#ff3232]/20"
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
                    className="w-full text-[#ddd] rounded-lg text-[0.8rem] cursor-pointer transition-all duration-200 font-medium bg-white/10 border border-solid border-white/5 py-1.5 px-3 hover:text-white hover:bg-white/20"
                  onClick={handleSaveEdited}
                >
                  {t("save", "Сохранить")}
                </button>
                <button
                    className="w-full rounded-lg text-[0.8rem] cursor-pointer transition-all duration-200 font-medium border border-solid text-[#ff4444] bg-[#ff3232]/10 border-[#ff3232]/20 hover:text-[#ff6666] hover:bg-[#ff3232]/20"
                  onClick={handleToggleEditMode}
                >
                  {t("cancel", "Отменить")}
                </button>
              </>
            )}
          </div>
        </header>

        <div className="p-0 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="p-10 text-center text-[#aaa] text-[0.9rem]">{t("loading", "Загрузка...")}</div>
          ) : (
            <ul className="list-none m-0 p-0">
              {members.map((member) => {
                const memberId = member.id;
                const avatarUrl = member.avatarUrl;
                return (
                  <li key={memberId} className="flex items-center transition-colors duration-200 py-4 px-6 border-b border-solid border-white/3 hover:bg-white/2">
                    <div className="w-11 h-11 rounded-full overflow-hidden mr-4 shrink-0 bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] shadow-[0_4px_10px_rgba(0,0,0,0.2)]">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                      ) : (
                        <Identicon userId={memberId} size={44} />
                      )}
                    </div>
                      <div className="flex-1 flex flex-col gap-1 overflow-hidden">
                          <span className="font-medium text-base text-white truncate">
                            {member.username}
                          </span>

                          <span
                              className={cn(
                                  "text-[0.75rem] font-semibold uppercase tracking-[0.5px] w-fit py-0.5 px-2 rounded-xl border border-solid",
                                  roleStyles[member.role] || roleStyles.member
                              )}
                          >
                            {member.role}
                          </span>
                      </div>

                    {/* Moderation Controls */}
                  {(currentUser?.role === "owner" || currentUser?.role === "admin") &&
                      memberId !== currentUserData.id && (
                          <div className="flex gap-2 ml-3">
                              {currentUser?.role === "owner" && (
                                  <button
                                      className="text-[#ddd] rounded-lg text-[0.8rem] cursor-pointer transition-all duration-200 font-medium bg-white/10 border border-solid border-white/5 py-1.5 px-3 hover:text-white hover:bg-white/20"
                                      onClick={() =>
                                          handleAction("change-participant-role", memberId, {
                                              role: member.role === "admin" ? "member" : "admin",
                                          })
                                      }
                                  >
                                      {member.role === "admin" ? "Снять админа" : "Дать админа"}
                                  </button>
                              )}

                              {member.role !== "owner" && (
                                  <button
                                      className="rounded-lg text-[0.8rem] cursor-pointer transition-all duration-200 font-medium border border-solid text-[#ff4444] bg-[#ff3232]/10 border-[#ff3232]/20 hover:text-[#ff6666] hover:bg-[#ff3232]/20 py-1.5 px-3"
                                      onClick={() => handleAction("kick-participant", memberId)}
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
