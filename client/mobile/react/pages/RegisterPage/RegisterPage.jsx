import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ROUTES } from "../../consts/routes.js";
import { STORAGE_KEYS } from "../../consts/storageKeys.js";
import { useToasts } from "../../hooks/useToasts.js";
import {
  registerUser,
  saveAuthSession,
  uploadAvatar,
} from "../../services/authApi.js";
import { cn } from "../../utils/cn.js";


const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export function RegisterPage() {
  const [step, setStep] = useState(1);
  const [avatar, setAvatar] = useState("");
  const [firstName, setFirstName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordRepeat, setShowPasswordRepeat] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToasts();
  const avatarInputRef = useRef(null);
  const passwordScore = useMemo(() => getPasswordScore(password), [password]);
  const { t, i18n } = useTranslation();

  if (localStorage.getItem(STORAGE_KEYS.TOKEN)) {
    window.location.href = ROUTES.CHATS;
  }

  function goTo(nextStep) {
    setStep(nextStep);
  }

  function handleAvatarChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (readerEvent) =>
      setAvatar(String(readerEvent.target?.result || ""));
    reader.readAsDataURL(file);
  }

  function continueFromName() {
    if (!firstName.trim()) {
      showToast("error", t("enterName", "Введите имя"), "⚠️");
      return;
    }

    goTo(3);
  }

  async function submitRegistration() {
    const cleanUsername = username.trim();
    const cleanFirstName = firstName.trim();

    if (cleanUsername.length < 3) {
      showToast(
        "error",
        t("usernameMinError", "Юзернейм: минимум 3 символа"),
        "⚠️",
      );
      return;
    }
    if (!USERNAME_PATTERN.test(cleanUsername)) {
      showToast(
        "error",
        t("usernameFormatError", "Только буквы, цифры и _"),
        "⚠️",
      );
      return;
    }
    if (password.length < 6) {
      showToast(
        "error",
        t("passwordMinError", "Пароль минимум 6 символов"),
        "⚠️",
      );
      return;
    }
    if (password !== passwordRepeat) {
      showToast("error", t("passwordsMismatch", "Пароли не совпадают"), "⚠️");
      return;
    }

    setIsSubmitting(true);
    try {
      const language =
        i18n.language ||
        localStorage.getItem(STORAGE_KEYS.LANGUAGE) ||
        "ru";
      const data = await registerUser({
        firstName: cleanFirstName,
        language,
        password,
        username: cleanUsername,
      });
      saveAuthSession({ language, token: data.token, user: data.user });
      await uploadAvatar({ avatar, token: data.token }).catch(() => {});
      showToast("success", t("welcomeDone", "Добро пожаловать!"), "🎉");
      window.setTimeout(() => {
        window.location.href = ROUTES.CHATS;
      }, 600);
    } catch (error) {
      showToast("error", error.message, "❌");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative w-full min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
      <div className="relative w-full min-h-screen md:overflow-hidden md:rounded-3xl md:w-100 md:h-150 md:min-h-150 md:bg-[var(--color-panel)] md:backdrop-blur-lg md:border md:border-white/[0.08] md:shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <WelcomeStep active={step === 1} onNext={() => goTo(2)} />
        <NameStep
          active={step === 2}
          avatar={avatar}
          avatarInputRef={avatarInputRef}
          firstName={firstName}
          onAvatarChange={handleAvatarChange}
          onBack={() => goTo(1)}
          onFirstNameChange={setFirstName}
          onNext={continueFromName}
        />
        <CredentialsStep
          active={step === 3}
          isSubmitting={isSubmitting}
          loginHref={ROUTES.LOGIN}
          onBack={() => goTo(2)}
          onPasswordChange={setPassword}
          onPasswordRepeatChange={setPasswordRepeat}
          onSubmit={submitRegistration}
          onTogglePassword={() => setShowPassword((value) => !value)}
          onTogglePasswordRepeat={() =>
            setShowPasswordRepeat((value) => !value)
          }
          onUsernameChange={setUsername}
          password={password}
          passwordRepeat={passwordRepeat}
          passwordScore={passwordScore}
          showPassword={showPassword}
          showPasswordRepeat={showPasswordRepeat}
          username={username}
        />
      </div>
    </div>
  );
}

function WelcomeStep({ active, onNext }) {
  const { t } = useTranslation();
  return (
    <section className={cn("screen", { active })} aria-hidden={!active}>
      <div className="w-24 h-24 rounded-[28px] overflow-hidden mb-7 shadow-[0_20px_60px_rgba(255,0,127,0.4)] animate-[glow_3s_ease-in-out_infinite]">
        <img
            className="w-full h-full object-cover"
          src="https://i.ibb.co/1Y4Pg7BF/94-20260317155000.png"
          alt="CraneApp"
        />
      </div>
      <div className="text-[28px] font-extrabold text-center mb-3 tracking-[-0.03em] bg-gradient-to-br from-white to-white/80 bg-clip-text text-transparent">
        {t("welcomeRegisterTitle", "Добро пожаловать<br>в CraneApp")
          .split("<br>")
          .map((line, index) => (
            <FragmentLine index={index} key={line} line={line} />
          ))}
      </div>
      <div className="flex flex-col gap-2.5 w-full max-w-80 mt-6 mb-9">
        <Feature
          icon="🔒"
          text={t("welcomeFeatureE2E", "End-to-end шифрование всех сообщений")}
        />
        <Feature
          icon="⚡️"
          text={t(
            "welcomeFeatureDelivery",
            "Мгновенная доставка в любой точке мира",
          )}
        />
        <Feature
          icon="🎨"
          text={t(
            "welcomeFeatureMedia",
            "Голосовые, видео, стикеры и многое другое",
          )}
        />
        <Feature
          icon="🛡️"
          text={t(
            "welcomeFeaturePrivacy",
            "Полная защита данных и приватность",
          )}
        />
      </div>
      <button className="w-full max-w-85 rounded-2xl border-none text-white text-base font-bold cursor-pointer p-[17px] tracking-[-0.01em] bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] shadow-[0_8px_32px_rgba(255,0,127,0.35)] transition-[transform,box-shadow] duration-150 appearance-none active:scale-[0.97] active:shadow-[0_4px_16px_rgba(255,0,127,0.2)] disabled:opacity-50 disabled:cursor-not-allowed" type="button" onClick={onNext}>
        {t("createAccount", "Создать аккаунт")}
      </button>
      <div className="mt-5 text-sm text-center text-white/40 [&_a]:text-accent [&_a]:no-underline [&_a]:font-semibold">
        {t("alreadyHaveAccount", "Уже есть аккаунт?")}{" "}
        <Link to={ROUTES.LOGIN}>{t("login", "Войти")}</Link>
      </div>
    </section>
  );
}

function NameStep({
  active,
  avatar,
  avatarInputRef,
  firstName,
  onAvatarChange,
  onBack,
  onFirstNameChange,
  onNext,
}) {
  const { t } = useTranslation();
  return (
    <section className={cn("screen", { active })} aria-hidden={!active}>
      <BackButton onClick={onBack} />
      <ProgressDots activeIndex={0} />
      <div className="text-2xl font-bold text-center mb-1.5 tracking-[-0.03em]">{t("whatIsYourName", "Как вас зовут?")}</div>
      <div className="text-sm text-center mb-7 text-white/45">
        {t("addPhotoName", "Добавьте фото и введите своё имя")}
      </div>

      <button
        className="group w-25 h-25 rounded-full flex flex-col items-center justify-center cursor-pointer mb-6 overflow-hidden relative bg-gradient-to-br from-[rgba(255,0,127,0.2)] to-[rgba(157,0,255,0.2)] border-2 border-dashed border-white/20 transition-[border-color,transform] duration-200 active:scale-95"
        type="button"
        onClick={() => avatarInputRef.current?.click()}
        style={avatar ? { border: "2px solid rgba(255,0,127,0.4)" } : undefined}
      >
        {avatar ? (
          <img src={avatar} alt="" className="w-full h-full object-cover rounded-full" />
        ) : (
          <span style={{ fontSize: 36 }}>🔒</span>
        )}
        <div className="rounded-full hidden group-hover:flex absolute inset-0 items-center justify-center bg-black/50">
          <CameraIcon />
        </div>
      </button>
      <div className="text-[11px] text-center mt-1 text-white/40">
        {t("tapAddPhoto", "Нажмите чтобы добавить фото")}
      </div>
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={onAvatarChange}
      />

      <div className="w-full max-w-85 mb-4 relative" style={{ marginTop: 20 }}>
        <label className="block text-xs font-semibold uppercase tracking-[0.04em] mb-2 text-white/40" htmlFor="firstName">{t("firstName", "Имя")}</label>
        <input
          id="firstName"
          type="text"
          value={firstName}
          onChange={(event) => onFirstNameChange(event.target.value)}
          placeholder={t("firstNamePlaceholder", "Ваше имя")}
          autoComplete="given-name"
          maxLength={64}
          className="w-full rounded-[14px] text-white text-base outline-none px-[18px] py-4 border-[1.5px] border-solid border-white/5 bg-white/5 transition-[border-color,background-color] duration-[180ms] appearance-none focus:border-[var(--color-accent)] focus:bg-white/8 placeholder:text-white/25"
        />
      </div>

      <button
        className="w-full max-w-85 rounded-2xl border-none text-white text-base font-bold cursor-pointer p-[17px] tracking-[-0.01em] bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] shadow-[0_8px_32px_rgba(255,0,127,0.35)] transition-[transform,box-shadow] duration-150 appearance-none active:scale-[0.97] active:shadow-[0_4px_16px_rgba(255,0,127,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
        type="button"
        onClick={onNext}
        style={{ marginTop: 8 }}
      >
        {t("continueAction", "Продолжить")}
      </button>
    </section>
  );
}

function CredentialsStep(props) {
  const strength = getStrengthStyle(props.passwordScore);
  const { t } = useTranslation();
  return (
    <section
      className={cn("screen", { active: props.active })}
      aria-hidden={!props.active}
    >
      <BackButton onClick={props.onBack} />
      <ProgressDots activeIndex={1} />
      <div style={{ fontSize: 48, marginBottom: 8, textAlign: "center" }}>
        🔐
      </div>
      <div className="text-2xl font-bold text-center mb-1.5 tracking-[-0.03em]">
        {t("chooseLoginTitle", "Придумайте логин")}
      </div>
      <div className="text-sm text-center mb-7 text-white/45">
        {t("chooseLoginSub", "Юзернейм и пароль для входа")}
      </div>

      <div className="w-full max-w-85 mb-4 relative">
        <label className="block text-xs font-semibold uppercase tracking-[0.04em] mb-2 text-white/40" htmlFor="username">{t("username", "Юзернейм")}</label>
        <input
          id="username"
          type="text"
          value={props.username}
          onChange={(event) =>
            props.onUsernameChange(
              event.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
            )
          }
          placeholder="@username"
          autoComplete="username"
          minLength={3}
          maxLength={32}
          className="w-full rounded-[14px] text-white text-base outline-none px-[18px] py-4 border-[1.5px] border-solid border-white/5 bg-white/5 transition-[border-color,background-color] duration-[180ms] appearance-none focus:border-[var(--color-accent)] focus:bg-white/8 placeholder:text-white/25"
        />
      </div>
      <PasswordField
        id="password"
        label={t("password", "Пароль")}
        onChange={props.onPasswordChange}
        onToggle={props.onTogglePassword}
        placeholder={t("passwordMin", "Минимум 6 символов")}
        show={props.showPassword}
        value={props.password}
      />
      <div className="h-[3px] rounded-sm mt-1.5 bg-white/8 transition-all duration-300">
          <div
              className="h-full rounded-sm transition-[width,background-color] duration-300"
              style={strength}
          />
      </div>
      <PasswordField
        id="password2"
        label={t("repeatPassword", "Повторите пароль")}
        onChange={props.onPasswordRepeatChange}
        onToggle={props.onTogglePasswordRepeat}
        placeholder={t("repeatPassword", "Повторите пароль")}
        show={props.showPasswordRepeat}
        value={props.passwordRepeat}
      />

      <button
        className="w-full max-w-85 rounded-2xl border-none text-white text-base font-bold cursor-pointer p-[17px] tracking-[-0.01em] bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] shadow-[0_8px_32px_rgba(255,0,127,0.35)] transition-[transform,box-shadow] duration-150 appearance-none active:scale-[0.97] active:shadow-[0_4px_16px_rgba(255,0,127,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
        type="button"
        onClick={props.onSubmit}
        disabled={props.isSubmitting}
      >
        {props.isSubmitting
          ? t("creatingAccount", "Создание аккаунта...")
          : t("createAccount", "Создать аккаунт")}
      </button>
      <div className="mt-5 text-sm text-center text-white/40 [&_a]:text-accent [&_a]:no-underline [&_a]:font-semibold">
        {t("alreadyHaveAccount", "Уже есть аккаунт?")}{" "}
        <a href={props.loginHref}>{t("login", "Войти")}</a>
      </div>
    </section>
  );
}

function PasswordField({
  id,
  label,
  onChange,
  onToggle,
  placeholder,
  show,
  value,
}) {
  return (
    <div className="w-full max-w-85 mb-4 relative">
      <label className="block text-xs font-semibold uppercase tracking-[0.04em] mb-2 text-white/40" htmlFor={id}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
          style={{ paddingRight: 44 }}
          className="w-full rounded-[14px] text-white text-base outline-none px-[18px] py-4 border-[1.5px] border-solid border-white/5 bg-white/5 transition-[border-color,background-color] duration-[180ms] appearance-none focus:border-[var(--color-accent)] focus:bg-white/8 placeholder:text-white/25"
        />
        <button className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer p-1 text-white/40 w-auto m-0 text-[0px] active:text-white/80" type="button" onClick={onToggle}>
          <EyeIcon visible={show} />
        </button>
      </div>
    </div>
  );
}

function Feature({ icon, text }) {
  return (
    <div className="flex items-center gap-3 text-sm text-white/60">
      <div
        className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[18px] shrink-0 [&_img.apple-emoji]:w-[22px] [&_img.apple-emoji]:h-[22px]"
        style={{ background: "rgba(255,0,127,0.15)" }}
      >
        {icon}
      </div>
      <span>{text}</span>
    </div>
  );
}

function ProgressDots({ activeIndex }) {
    return (
        <div className="flex gap-1.5 mb-8">
            {[0, 1].map((index) => (
                <div
                    key={index}
                    className={`h-1.5 transition-all duration-300 ${
                        index === activeIndex
                            ? "w-5 rounded-[3px] bg-accent"
                            : "w-1.5 rounded-full bg-white/15"
                    }`}
                />
            ))}
        </div>
    );
}

function BackButton({ onClick }) {
  return (
    <button className="absolute left-4 w-10 h-10 rounded-full border-none text-white cursor-pointer flex items-center justify-center top-[calc(env(safe-area-inset-top,0px)+16px)] bg-white/7 transition-colors duration-150 active:bg-white/14 md:top-6 md:left-6" type="button" onClick={onClick}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  );
}

function CameraIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function EyeIcon({ visible }) {
  if (visible) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(255,0,127,0.8)"
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
      stroke="rgba(255,255,255,0.4)"
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

function FragmentLine({ index, line }) {
  return (
    <>
      {index > 0 ? <br /> : null}
      {line}
    </>
  );
}

function getPasswordScore(password) {
  return [
    password.length >= 6,
    password.length >= 10,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;
}

function getStrengthStyle(score) {
  const colors = ["#FF4B4B", "#FF8C00", "#FFD700", "#00C853", "#00E676"];
  const widths = ["20%", "40%", "60%", "80%", "100%"];
  return {
    background: score > 0 ? colors[score - 1] : "transparent",
    width: score > 0 ? widths[score - 1] : "0%",
  };
}