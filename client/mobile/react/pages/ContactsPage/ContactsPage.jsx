import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Identicon } from "../../components/ui/Identicon.jsx";
import { useToasts } from "../../hooks/useToasts.js";
import services from "../../services/serviceContainer.js";

export function ContactsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToasts();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("");

  async function handleSearch(val) {
    setQuery(val);
    const cleanQuery = val.trim().replace("@", "");

    if (cleanQuery.length < 2) {
      setUsers([]);
      setStatusText("");
      return;
    }

    setIsLoading(true);
    setStatusText("Поиск...");
    try {
      const foundUsers = await services.chatService.searchUsers(cleanQuery);
      if (foundUsers.length > 0) {
        setUsers(foundUsers);
        setStatusText(`Найдено: ${foundUsers.length}`);
      } else {
        setUsers([]);
        setStatusText("Ничего не найдено");
      }
    } catch (err) {
      setUsers([]);
      setStatusText(`Ошибка: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function startChat(userId) {
    try {
      const data = await services.chatService.createChat("private", [userId]);
      if (data.chatId) {
        showToast("success", "Чат создан!", "✓");
        setTimeout(() => {
          navigate(`/chats/${encodeURIComponent(data.chatId)}`);
        }, 800);
      } else {
        throw new Error(data.error || "Не удалось создать чат");
      }
    } catch (err) {
      showToast("error", err.message, "❌");
    }
  }

  return (
    <main className="w-full box-border pt-[calc(16px+env(safe-area-inset-top,0px))] pb-[calc(90px+env(safe-area-inset-bottom,0px))] px-4 md:h-full md:overflow-y-auto md:py-12 md:px-16 md:min-h-0">
      <header className="flex items-center gap-[14px] mb-6 md:mb-9">
        <button className="bg-transparent border-0 text-[28px] cursor-pointer p-0 leading-none shrink-0 text-[var(--color-accent)] md:hidden" onClick={() => navigate("/chats")}>
          ‹
        </button>
        <h1 className="m-0 text-[22px] font-bold md:text-[30px] md:font-extrabold">{t("contactsAndSearch", "Контакты и Поиск")}</h1>
      </header>

      <input
        type="search"
        className="w-full rounded-[12px] bg-[#1e1e1e] text-white text-[15px] outline-none mb-[18px] py-3 px-4 border-2 border-solid border-[#333] focus:border-[var(--color-accent)]"
        placeholder={t("searchPlaceholder", "Введите имя пользователя...")}
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
      />

      {statusText && (
        <p
          style={{
            fontSize: 13,
            color: "var(--react-muted)",
            marginBottom: 12,
          }}
        >
          {statusText}
        </p>
      )}

      <section className="flex flex-col gap-[10px]">
        {users.length === 0 && !isLoading && (
          <div
            style={{
              textAlign: "center",
              marginTop: 40,
              color: "var(--react-muted)",
            }}
          >
            <span style={{ fontSize: 48, display: "block", marginBottom: 10 }}>
              🔍
            </span>
            <p>Введите юзернейм для начала диалога</p>
          </div>
        )}

        {users.map((user) => {
          return (
            <div
              key={user.id}
              className="flex items-center justify-between rounded-[14px] cursor-pointer transition-colors duration-200 no-underline text-white py-3 px-[14px] bg-[var(--color-panel)] border border-solid border-white/5 hover:bg-white/4"
              onClick={() => startChat(user.id)}
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-white overflow-hidden bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)]">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Identicon userId={user.id} size={44} />
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="font-semibold text-[15px]">
                    {user.firstName || "Пользователь"}
                  </span>
                  <span className="text-xs text-[var(--color-muted)]">@{user.username}</span>
                </div>
              </div>
              <button
                  className="w-full rounded-[12px] text-white text-[15px] font-bold cursor-pointer mt-[18px] border-0 p-3.5 bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  width: "auto",
                  margin: 0,
                  padding: "6px 12px",
                  fontSize: 13,
                }}
              >
                Написать
              </button>
            </div>
          );
        })}
      </section>
    </main>
  );
}
