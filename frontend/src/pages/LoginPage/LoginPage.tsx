import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ROUTES } from "../../consts/routes.js";
import { STORAGE_KEYS } from "../../consts/storageKeys.js";
import { useToasts } from "../../hooks/useToasts.js";
import {
  fetchUserSettings,
  loginUser,
  saveAuthSession,
} from "../../services/authApi.js";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToasts();
  const { t } = useTranslation();

  if (localStorage.getItem(STORAGE_KEYS.TOKEN)) {
    window.location.href = ROUTES.CHATS;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanUsername = username.trim();

    if (!cleanUsername || !password) {
      showToast("error", t("loginRequired", "Введите юзернейм и пароль"), "⚠️");
      return;
    }

    setIsSubmitting(true);
    try {
      const clientIP = await getClientIP();
      let data = await loginUser({
        clientIP,
        password,
        username: cleanUsername,
      });

      if (data.twoFARequired) {
        const twoFAPassword = window.prompt(
          t("twoFAPrompt", "Введите дополнительный пароль (2FA):"),
        );
        if (!twoFAPassword) {
          setIsSubmitting(false);
          return;
        }

        data = await loginUser({
          clientIP,
          password,
          twoFAPassword,
          username: cleanUsername,
        });
      }

      if (!data.token) {
        throw new Error(t("invalidResponse", "Неверный формат ответа"));
      }

      const settings = await fetchUserSettings(data.token);
      saveAuthSession({ settings, token: data.token, user: data.user });
      showToast("success", t("loginDone", "Вход выполнен!"), "✓");
      window.setTimeout(() => {
        window.location.href = ROUTES.CHATS;
      }, 500);
    } catch (error) {
      showToast("error", error.message, "❌");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-logo">
          <img
            src="https://i.ibb.co/1Y4Pg7BF/94-20260317155000.png"
            alt="CraneApp"
          />
        </div>
        <h1>CraneApp</h1>
        <p className="login-subtitle">
          {t("loginSubtitle", "Войдите в аккаунт")}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="loginUsername">{t("username", "Юзернейм")}</label>
            <input
              id="loginUsername"
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect="off"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="@username.123"
              type="text"
              value={username}
            />
          </div>

          <div className="login-field">
            <label htmlFor="loginPassword">{t("password", "Пароль")}</label>
            <div className="login-password-wrap">
              <input
                id="loginPassword"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={
                  showPassword
                    ? t("hidePassword", "Скрыть пароль")
                    : t("showPassword", "Показать пароль")
                }
                className="login-eye"
                onClick={() => setShowPassword((value) => !value)}
                type="button"
              >
                <EyeIcon visible={showPassword} />
              </button>
            </div>
          </div>

          <button
            className="login-submit"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? t("loginLoading", "Вход...") : t("login", "Войти")}
          </button>
        </form>

        <div className="login-footer">
          {t("noAccount", "Нет аккаунта?")}{" "}
          <Link to={ROUTES.REGISTER}>
            {t("registerAction", "Зарегистрироваться")}
          </Link>
        </div>
      </section>
    </main>
  );
}

async function getClientIP() {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    if (!response.ok) return "";
    const data = await response.json();
    return data.ip || "";
  } catch (_error) {
    return "";
  }
}

function EyeIcon({ visible }) {
  if (visible) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
