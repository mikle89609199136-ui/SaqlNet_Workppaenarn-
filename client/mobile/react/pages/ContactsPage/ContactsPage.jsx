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
    <main className="contacts-page">
      <header className="contacts-header">
        <button className="back-arrow-btn" onClick={() => navigate("/chats")}>
          ‹
        </button>
        <h1>{t("contactsAndSearch", "Контакты и Поиск")}</h1>
      </header>

      <input
        type="search"
        className="contacts-search-input"
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

      <section className="contacts-list">
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
              className="contact-item-row"
              onClick={() => startChat(user.id)}
            >
              <div className="contact-left">
                <div className="contact-avatar-circle">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" />
                  ) : (
                    <Identicon userId={user.id} size={44} />
                  )}
                </div>
                <div className="contact-details">
                  <span className="contact-name-title">
                    {user.firstName || "Пользователь"}
                  </span>
                  <span className="contact-username-sub">@{user.username}</span>
                </div>
              </div>
              <button
                className="create-group-btn"
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
