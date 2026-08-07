import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { disconnectRealtimeSocket } from "../../hooks/useRealtimeSocket.js";
import { useToasts } from "../../hooks/useToasts.js";
import services from "../../services/serviceContainer.js";
import "../../styles/SettingsPage.css";

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToasts();
  const [user, setUser] = useState({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [settings, setSettings] = useState({
    theme: "dark",
    language: "ru",
    notifications: true,
    sounds: true,
  });

  const token = localStorage.getItem("craneapp_auth_token");

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }

    // Sync profile and settings
    async function syncData() {
      try {
        const [nextUser, settingsPayload] = await Promise.all([
          services.userService.getMe(),
          services.userService.getSettings(),
        ]);

        if (nextUser) {
          setUser(nextUser);
          localStorage.setItem("craneapp_user_data", JSON.stringify(nextUser));
        }

        if (settingsPayload.settings) {
          setSettings(settingsPayload.settings);
          localStorage.setItem(
            "craneapp_settings",
            JSON.stringify(settingsPayload.settings),
          );
        }
      } catch (e) {
        showToast("error", "Ошибка синхронизации настроек с сервером", "⚠️");
      }
    }

    syncData();
  }, [token, navigate]);

  async function updateSetting(name, value) {
    const updated = { ...settings, [name]: value };
    setSettings(updated);
    localStorage.setItem("craneapp_settings", JSON.stringify(updated));

    try {
      await services.userService.updateSettings(updated);
      showToast("success", t("settingsSaved", "Настройки сохранены"), "✓");
    } catch (_) {
      showToast("error", "Не удалось сохранить настройки на сервере", "⚠️");
    }
  }

  async function handleLogout() {
    await services.authService.logout().catch(() => {
      localStorage.removeItem("craneapp_auth_token");
      localStorage.removeItem("craneapp_user_data");
    });
    disconnectRealtimeSocket();
    localStorage.removeItem("craneapp_settings");
    navigate("/login");
  }

  const userInitials = (user.firstName || user.username || "U")
    .charAt(0)
    .toUpperCase();

  return (
    <main className="w-full box-border pt-[calc(16px+env(safe-area-inset-top,0px))] pb-[calc(90px+env(safe-area-inset-bottom,0px))] px-4 md:h-full md:overflow-y-auto md:py-12 md:px-16 md:min-h-0">
      <header className="flex items-center gap-[14px] mb-6 md:mb-9">
        <button className="bg-transparent border-0 text-[28px] cursor-pointer p-0 leading-none shrink-0 text-[var(--color-accent)] md:hidden" onClick={() => navigate("/chats")}>
          ‹
        </button>
        <h1 className="m-0 text-[22px] font-bold md:text-[30px] md:font-extrabold">{t("settings", "Настройки")}</h1>
      </header>

      <section className="flex items-center gap-4 rounded-[20px] mb-6 w-full box-border p-5 bg-[var(--color-panel)] border border-solid border-white/6 md:gap-6 md:rounded-[24px] md:mb-8 md:py-[28px] md:px-8">
        <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-[28px] text-white overflow-hidden shrink-0 bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] md:w-[88px] md:h-[88px] md:text-[36px]">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-full h-full object-cover"  />
          ) : (
            <span>{userInitials}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 mb-1 text-[18px] font-bold truncate md:text-[22px]">
            {user.firstName || "Пользователь"}
            {user.statusEmoji ? (
              <span style={{ marginLeft: 8 }}>{user.statusEmoji}</span>
            ) : null}
          </h2>
          <p className="m-0 text-[13px] text-[var(--color-muted)] md:text-sm">{user.username ? `@${user.username}` : ""}</p>
          {user.bio && <p className="m-0 text-[13px] text-[var(--color-muted)] md:text-sm" style={{ marginTop: 6, opacity: 0.8 }}>{user.bio}</p>}
        </div>
      </section>

      <section className="w-full box-border rounded-[20px] mb-5 overflow-hidden bg-[var(--color-panel)] border border-solid border-white/6 md:rounded-[24px] md:mb-6">
        <div
            className="flex items-center justify-between cursor-pointer transition-colors duration-200 text-white no-underline text-[15px] gap-3 py-[14px] px-[18px] border-b border-solid border-white/4 last:border-b-0 hover:bg-white/3 md:text-base md:py-[18px] md:px-6"
          onClick={() => setIsEditModalOpen(true)}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-[18px] shrink-0 md:text-[20px]">👤</span>
            <span>{t("editProfile", "Редактировать профиль")}</span>
          </div>
          <div className="flex items-center gap-2 text-sm shrink-0 whitespace-nowrap text-[var(--color-muted)] md:text-[15px]">
            <span>›</span>
          </div>
        </div>
      </section>

        <section className="w-full box-border rounded-[20px] mb-5 overflow-hidden bg-[var(--color-panel)] border border-solid border-white/6 md:rounded-[24px] md:mb-6">
            {/* Пункт: Уведомления */}
            <div className="flex items-center justify-between cursor-pointer transition-colors duration-200 text-white no-underline text-[15px] gap-3 py-[14px] px-[18px] border-b border-solid border-white/4 last:border-b-0 hover:bg-white/3 md:text-base md:py-[18px] md:px-6">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-[18px] shrink-0 md:text-[20px]">🔔</span>
                    <span>{t("notifications", "Уведомления")}</span>
                </div>

                {/* Тумблер Уведомлений */}
                <div
                    className={`w-11 h-6 rounded-xl relative transition-colors duration-200 cursor-pointer shrink-0 ${
                        settings.notifications ? "bg-[var(--color-accent)]" : "bg-[#333]"
                    }`}
                    onClick={() => updateSetting("notifications", !settings.notifications)}
                >
                    <div
                        className={`w-[18px] h-[18px] bg-white rounded-full absolute top-[3px] transition-all duration-200 ${
                            settings.notifications ? "left-[23px]" : "left-[3px]"
                        }`}
                    />
                </div>
            </div>

            {/* Пункт: Звуки */}
            <div className="flex items-center justify-between cursor-pointer transition-colors duration-200 text-white no-underline text-[15px] gap-3 py-[14px] px-[18px] border-b border-solid border-white/4 last:border-b-0 hover:bg-white/3 md:text-base md:py-[18px] md:px-6">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-[18px] shrink-0 md:text-[20px]">🎵</span>
                    <span>{t("sounds", "Звуки")}</span>
                </div>

                {/* Тумблер Звуков */}
                <div
                    className={`w-11 h-6 rounded-xl relative transition-colors duration-200 cursor-pointer shrink-0 ${
                        settings.sounds ? "bg-[var(--color-accent)]" : "bg-[#333]"
                    }`}
                    onClick={() => updateSetting("sounds", !settings.sounds)}
                >
                    <div
                        className={`w-[18px] h-[18px] bg-white rounded-full absolute top-[3px] transition-all duration-200 ${
                            settings.sounds ? "left-[23px]" : "left-[3px]"
                        }`}
                    />
                </div>
            </div>
        </section>

      <section className="w-full box-border rounded-[20px] mb-5 overflow-hidden bg-[var(--color-panel)] border border-solid border-white/6 md:rounded-[24px] md:mb-6">
        <div
            className="flex items-center justify-between cursor-pointer transition-colors duration-200 text-white no-underline text-[15px] gap-3 py-[14px] px-[18px] border-b border-solid border-white/4 last:border-b-0 hover:bg-white/3 md:text-base md:py-[18px] md:px-6"
          onClick={() =>
            showToast(
              "info",
              "Эта функция будет доступна в следующем обновлении",
              "ℹ️",
            )
          }
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-[18px] shrink-0 md:text-[20px]">🎨</span>
            <span>{t("appearance", "Оформление")}</span>
          </div>
          <div className="flex items-center gap-2 text-sm shrink-0 whitespace-nowrap text-[var(--color-muted)] md:text-[15px]">
            <span>{settings.theme === "dark" ? "Тёмная" : "Светлая"}</span>
            <span>›</span>
          </div>
        </div>

        <div
            className="flex items-center justify-between cursor-pointer transition-colors duration-200 text-white no-underline text-[15px] gap-3 py-[14px] px-[18px] border-b border-solid border-white/4 last:border-b-0 hover:bg-white/3 md:text-base md:py-[18px] md:px-6"
          onClick={() =>
            showToast(
              "info",
              "Эта функция будет доступна в следующем обновлении",
              "ℹ️",
            )
          }
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-[18px] shrink-0 md:text-[20px]">🌐</span>
            <span>{t("language", "Язык")}</span>
          </div>
          <div className="flex items-center gap-2 text-sm shrink-0 whitespace-nowrap text-[var(--color-muted)] md:text-[15px]">
            <span>Русский</span>
            <span>›</span>
          </div>
        </div>
      </section>

      <div className="mt-[30px] w-full">
        <button className="w-full rounded-[12px] text-[#ff3366] text-[15px] font-bold cursor-pointer transition-colors duration-200 box-border p-3.5 border border-solid border-[#ff3366]/25 bg-[#ff3366]/8 hover:bg-[#ff3366]/15 md:text-base md:rounded-2xl md:p-4" onClick={handleLogout}>
          {t("logout", "Выйти из аккаунта")}
        </button>
      </div>

      {isEditModalOpen && (
        <EditProfileModal
          user={user}
          onClose={() => setIsEditModalOpen(false)}
          onSave={async (updatedFields) => {
            try {
              const updatedUser =
                await services.userService.updateMe(updatedFields);
              setUser(updatedUser);
              localStorage.setItem(
                "craneapp_user_data",
                JSON.stringify(updatedUser),
              );
              showToast("success", "Профиль обновлен", "✓");
              setIsEditModalOpen(false);
            } catch (e) {
              showToast("error", "Не удалось обновить профиль", "⚠️");
            }
          }}
        />
      )}
    </main>
  );
}

function EditProfileModal({ user, onClose, onSave }) {
  const [firstName, setFirstName] = useState(user.firstName || "");
  const [lastName, setLastName] = useState(user.lastName || "");
  const [bio, setBio] = useState(user.bio || "");
  const [statusEmoji, setStatusEmoji] = useState(user.statusEmoji || "");
  const [isSaving, setIsSaving] = useState(false);
  const { t } = useTranslation();

  const emojiOptions = [
    "",
    "😀",
    "😎",
    "💼",
    "🚀",
    "🔥",
    "🎉",
    "✈️",
    "🎮",
    "🎧",
    "😴",
    "🐱",
    "🍕",
    "☕",
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({ firstName, lastName, bio, statusEmoji });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
        className="fixed inset-0 z-[1000] flex justify-center items-center bg-black/40 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]"
      onClick={onClose}
      style={{ zIndex: 20000 }}
    >
      <div
          className="w-full flex flex-col overflow-hidden h-full max-h-screen max-w-[500px] bg-[#141416]/85 border border-solid border-white/10 border-b-0 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] animate-[slideUp_0.3s_cubic-bezier(0.2,0.8,0.2,1)] md:max-h-[85vh] md:rounded-3xl glass-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 400 }}
      >
        <header className="flex flex-col gap-y-5 py-5 px-6 border-b border-solid border-white/5">
          <h2 className="text-[1.2rem] font-semibold m-0 bg-gradient-to-br from-white to-[#aaa] bg-clip-text text-transparent" >Редактировать профиль</h2>
          <button className="w-8 h-8 rounded-full text-white text-base cursor-pointer flex items-center justify-center transition-colors duration-200 border-none bg-white/10 hover:bg-white/20" onClick={onClose}>
            ✕
          </button>
        </header>
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Имя</label>
            <input
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Имя"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: "8px 12px",
                color: "#fff",
                fontSize: 15,
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Фамилия</label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Фамилия"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: "8px 12px",
                color: "#fff",
                fontSize: 15,
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>О себе</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="О себе"
              rows={3}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: "8px 12px",
                color: "#fff",
                fontSize: 15,
                resize: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Статус-эмодзи</label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 4,
              }}
            >
              {emojiOptions.map((emoji) => (
                <button
                  type="button"
                  key={emoji || "none"}
                  onClick={() => setStatusEmoji(emoji)}
                  style={{
                    fontSize: 18,
                    background:
                      statusEmoji === emoji
                        ? "var(--rd-accent-grad, #ff2d8b)"
                        : "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    padding: 6,
                    cursor: "pointer",
                    minWidth: 36,
                    height: 36,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                  }}
                >
                  {emoji || "✕"}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={isSaving || !firstName.trim()}
            style={{
              marginTop: 10,
              background:
                "var(--rd-accent-grad, linear-gradient(135deg, #ff2d8b 0%, #9b5cff 100%))",
              border: 0,
              borderRadius: 8,
              padding: "10px 16px",
              color: "#fff",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            {isSaving ? "Сохранение..." : "Сохранить"}
          </button>
        </form>
      </div>
    </div>
  );
}
