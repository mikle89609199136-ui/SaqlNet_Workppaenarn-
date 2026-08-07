import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "../../consts/routes.js";
import { useToasts } from "../../hooks/useToasts.js";
import services from "../../services/serviceContainer.js";

export function CreateGroupPage() {
  const navigate = useNavigate();
  const { showToast } = useToasts();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const { t } = useTranslation();

  async function handleSearch(val) {
    setSearchQuery(val);
    const cleanVal = val.trim().replace("@", "");
    if (cleanVal.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const users = await services.chatService.searchUsers(cleanVal);
      setSearchResults(users);
    } catch (_) {
      // Игнорируем ошибки поиска в фоне
    }
  }

  function toggleMember(user) {
    if (selectedMembers.some((m) => m.id === user.id)) {
      setSelectedMembers(selectedMembers.filter((m) => m.id !== user.id));
    } else {
      setSelectedMembers([...selectedMembers, user]);
    }
  }

  async function handleCreateGroup() {
    if (!title.trim()) {
      showToast("error", "Введите название группы", "⚠️");
      return;
    }
    if (selectedMembers.length === 0) {
      showToast("error", "Выберите хотя бы одного участника", "⚠️");
      return;
    }

    setIsCreating(true);
    try {
      const members = selectedMembers.map((m) => m.id);
      const data = await services.chatService.createGroup({
        title,
        description,
        members,
      });
      if (data.chatId) {
        showToast("success", "Группа успешно создана!", "🎉");
        setTimeout(() => {
          navigate(`/chats/${encodeURIComponent(data.chatId)}`);
        }, 800);
      } else {
        throw new Error(data.error || "Не удалось создать группу");
      }
    } catch (err) {
      showToast("error", err.message, "❌");
      setIsCreating(false);
    }
  }

  return (
    <main className="w-full box-border pt-[calc(16px+env(safe-area-inset-top,0px))] pb-[calc(90px+env(safe-area-inset-bottom,0px))] px-4 md:h-full md:overflow-y-auto md:py-12 md:px-16 md:min-h-0">
      <header className="flex items-center gap-[14px] mb-6 md:mb-9">
        <Link className="bg-transparent border-0 text-[28px] cursor-pointer p-0 leading-none shrink-0 text-[var(--color-accent)] md:hidden" to={ROUTES.CHATS}>
          ‹
        </Link>
        <h1 className="m-0 text-[22px] font-bold md:text-[30px] md:font-extrabold">{t("newGroup", "Новая группа")}</h1>
      </header>

      <section>
        <input
          type="text"
          className="w-full rounded-[12px] bg-[#1e1e1e] text-white text-[15px] outline-none mb-[18px] py-3 px-4 border-2 border-solid border-[#333] focus:border-[var(--color-accent)]"
          placeholder={t("groupTitlePlaceholder", "Название группы")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={50}
        />

        <input
          type="text"
          className="w-full rounded-[12px] bg-[#1e1e1e] text-white text-[15px] outline-none mb-[18px] py-3 px-4 border-2 border-solid border-[#333] focus:border-[var(--color-accent)]"
          placeholder={t("groupDescPlaceholder", "Описание (необязательно)")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={255}
        />
      </section>

      <section style={{ marginBottom: 20 }}>
        <h3>{t("addMembers", "Добавить участников")}</h3>
        <input
          type="search"
          className="w-full rounded-[12px] bg-[#1e1e1e] text-white text-[15px] outline-none mb-[18px] py-3 px-4 border-2 border-solid border-[#333] focus:border-[var(--color-accent)]"
          placeholder={t("searchUsers", "Поиск по юзернейму...")}
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
        />

        <div className="flex flex-col gap-[10px]">
          {searchResults.map((user) => {
            const isChecked = selectedMembers.some((m) => m.id === user.id);
            const initials = (user.firstName || user.username || "?")
              .charAt(0)
              .toUpperCase();

            return (
              <div
                key={user.id}
                className="flex items-center justify-between rounded-[14px] cursor-pointer transition-colors duration-200 no-underline text-white py-3 px-[14px] bg-[var(--color-panel)] border border-solid border-white/5 hover:bg-white/4"
                onClick={() => toggleMember(user)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-white overflow-hidden bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)]">
                    {user.avatarUrl ? (
                      <img className="w-full h-full object-cover" src={user.avatarUrl} alt="" />
                    ) : (
                      <span>{initials}</span>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-semibold text-[15px]">
                      {user.firstName || "Пользователь"}
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">
                      @{user.username}
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="w-[22px] h-[22px] rounded-[6px] border-2 border-solid border-[#555] accent-[var(--color-accent)]"
                  checked={isChecked}
                  onChange={() => {}} // Обрабатывается кликом по строке
                />
              </div>
            );
          })}
        </div>
      </section>

      {selectedMembers.length > 0 && (
          <section className="mb-6 animate-[fadeIn_0.3s_ease]">
              <h4 className="text-[0.9rem] text-[#bbb] mb-3 font-medium">
                  Выбрано ({selectedMembers.length}):
              </h4>

              <div className="flex flex-wrap gap-[10px]">
                  {selectedMembers.map((m) => (
                      <div
                          key={m.id}
                          onClick={() => toggleMember(m)}
                          className="group rounded-[20px] text-[0.85rem] cursor-pointer flex items-center gap-2 text-white transition-all duration-200 bg-gradient-to-br from-white/10 to-white/5 border border-solid border-white/10 py-1.5 px-[14px] backdrop-blur-[4px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:-translate-y-px hover:bg-gradient-none hover:bg-[#ff3232]/15 hover:border-[#ff3232]/30"
                      >
                          <span>{m.firstName || m.username}</span>
                          <span className="text-[0.8rem] text-[#aaa] transition-colors duration-200 group-hover:text-[#ff6666]">
                              ✕
                            </span>
                      </div>
                  ))}
              </div>
          </section>
      )}

      <button
          className="w-full rounded-[12px] text-white text-[15px] font-bold cursor-pointer mt-[18px] border-0 p-3.5 bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={isCreating || !title.trim() || selectedMembers.length === 0}
        onClick={handleCreateGroup}
      >
        {isCreating
          ? t("creating", "Создание...")
          : t("createGroupAction", "Создать группу")}
      </button>
    </main>
  );
}
