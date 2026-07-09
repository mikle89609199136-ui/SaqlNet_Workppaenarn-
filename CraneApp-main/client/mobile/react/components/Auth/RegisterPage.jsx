import { useMemo, useRef, useState } from 'react';
import { ToastStack } from '../common/ToastStack.jsx';
import { registerUser, saveAuthSession, uploadAvatar } from '../../services/authApi.js';
import { useToasts } from '../../hooks/useToasts.js';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export function RegisterPage({
  loginHref = './login.html',
  redirectPath = '/chats',
  t = fallbackTranslate,
}) {
  const [step, setStep] = useState(1);
  const [avatar, setAvatar] = useState('');
  const [firstName, setFirstName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordRepeat, setShowPasswordRepeat] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast, toasts } = useToasts();
  const avatarInputRef = useRef(null);
  const passwordScore = useMemo(() => getPasswordScore(password), [password]);

  if (localStorage.getItem('craneapp_auth_token')) {
    window.location.href = redirectPath;
  }

  function goTo(nextStep) {
    setStep(nextStep);
  }

  function handleAvatarChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (readerEvent) => setAvatar(String(readerEvent.target?.result || ''));
    reader.readAsDataURL(file);
  }

  function continueFromName() {
    if (!firstName.trim()) {
      showToast('error', t('enterName', 'Введите имя'), '⚠️');
      return;
    }

    goTo(3);
  }

  async function submitRegistration() {
    const cleanUsername = username.trim();
    const cleanFirstName = firstName.trim();

    if (cleanUsername.length < 3) {
      showToast('error', t('usernameMinError', 'Юзернейм: минимум 3 символа'), '⚠️');
      return;
    }
    if (!USERNAME_PATTERN.test(cleanUsername)) {
      showToast('error', t('usernameFormatError', 'Только буквы, цифры и _'), '⚠️');
      return;
    }
    if (password.length < 10) {
      showToast('error', t('passwordMinError', 'Пароль минимум 10 символов'), '⚠️');
      return;
    }
    if (password !== passwordRepeat) {
      showToast('error', t('passwordsMismatch', 'Пароли не совпадают'), '⚠️');
      return;
    }

    setIsSubmitting(true);
    try {
      const language = window.i18n?.currentLang || localStorage.getItem('craneapp_language') || 'ru';
      const data = await registerUser({ firstName: cleanFirstName, language, password, username: cleanUsername });
      saveAuthSession({ language, token: data.token, user: data.user });
      await uploadAvatar({ avatar, token: data.token }).catch(() => {});
      showToast('success', t('welcomeDone', 'Добро пожаловать!'), '🎉');
      window.setTimeout(() => {
        window.location.href = redirectPath;
      }, 600);
    } catch (error) {
      showToast('error', error.message, '❌');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="register-page">
      <div className="register-container">
        <ToastStack toasts={toasts} />
        <WelcomeStep active={step === 1} loginHref={loginHref} onNext={() => goTo(2)} t={t} />
        <NameStep
          active={step === 2}
          avatar={avatar}
          avatarInputRef={avatarInputRef}
          firstName={firstName}
          onAvatarChange={handleAvatarChange}
          onBack={() => goTo(1)}
          onFirstNameChange={setFirstName}
          onNext={continueFromName}
          t={t}
        />
        <CredentialsStep
          active={step === 3}
          isSubmitting={isSubmitting}
          loginHref={loginHref}
          onBack={() => goTo(2)}
          onPasswordChange={setPassword}
          onPasswordRepeatChange={setPasswordRepeat}
          onSubmit={submitRegistration}
          onTogglePassword={() => setShowPassword((value) => !value)}
          onTogglePasswordRepeat={() => setShowPasswordRepeat((value) => !value)}
          onUsernameChange={setUsername}
          password={password}
          passwordRepeat={passwordRepeat}
          passwordScore={passwordScore}
          showPassword={showPassword}
          showPasswordRepeat={showPasswordRepeat}
          t={t}
          username={username}
        />
      </div>
    </div>
  );
}

function WelcomeStep({ active, loginHref, onNext, t }) {
  return (
    <section className={`screen ${active ? 'active' : ''}`} aria-hidden={!active}>
      <div className="welcome-logo">
        <img src="https://i.ibb.co/1Y4Pg7BF/94-20260317155000.png" alt="CraneApp" />
      </div>
      <div className="welcome-title">{t('welcomeRegisterTitle', 'Добро пожаловать<br>в CraneApp').split('<br>').map((line, index) => (
        <FragmentLine index={index} key={line} line={line} />
      ))}</div>
      <div className="welcome-features">
        <Feature icon="🔒" text={t('welcomeFeatureE2E', 'End-to-end шифрование всех сообщений')} />
        <Feature icon="⚡️" text={t('welcomeFeatureDelivery', 'Мгновенная доставка в любой точке мира')} />
        <Feature icon="🎨" text={t('welcomeFeatureMedia', 'Голосовые, видео, стикеры и многое другое')} />
        <Feature icon="🛡️" text={t('welcomeFeaturePrivacy', 'Полная защита данных и приватность')} />
      </div>
      <button className="btn-primary" type="button" onClick={onNext}>{t('createAccount', 'Создать аккаунт')}</button>
      <div className="footer-link">
        {t('alreadyHaveAccount', 'Уже есть аккаунт?')} <a href={loginHref}>{t('login', 'Войти')}</a>
      </div>
    </section>
  );
}

function NameStep({ active, avatar, avatarInputRef, firstName, onAvatarChange, onBack, onFirstNameChange, onNext, t }) {
  return (
    <section className={`screen ${active ? 'active' : ''}`} aria-hidden={!active}>
      <BackButton onClick={onBack} />
      <ProgressDots activeIndex={0} />
      <div className="step-title">{t('whatIsYourName', 'Как вас зовут?')}</div>
      <div className="step-sub">{t('addPhotoName', 'Добавьте фото и введите своё имя')}</div>

      <button className="avatar-upload" type="button" onClick={() => avatarInputRef.current?.click()} style={avatar ? { border: '2px solid rgba(255,0,127,0.4)' } : undefined}>
        {avatar ? <img src={avatar} alt="" /> : <span style={{ fontSize: 36 }}>🔒</span>}
        <div className="avatar-edit-overlay"><CameraIcon /></div>
      </button>
      <div className="avatar-upload-hint">{t('tapAddPhoto', 'Нажмите чтобы добавить фото')}</div>
      <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onAvatarChange} />

      <div className="field" style={{ marginTop: 20 }}>
        <label htmlFor="firstName">{t('firstName', 'Имя')}</label>
        <input id="firstName" type="text" value={firstName} onChange={(event) => onFirstNameChange(event.target.value)} placeholder={t('firstNamePlaceholder', 'Ваше имя')} autoComplete="given-name" maxLength={64} />
      </div>

      <button className="btn-primary" type="button" onClick={onNext} style={{ marginTop: 8 }}>{t('continueAction', 'Продолжить')}</button>
    </section>
  );
}

function CredentialsStep(props) {
  const strength = getStrengthStyle(props.passwordScore);
  return (
    <section className={`screen ${props.active ? 'active' : ''}`} aria-hidden={!props.active}>
      <BackButton onClick={props.onBack} />
      <ProgressDots activeIndex={1} />
      <div style={{ fontSize: 48, marginBottom: 8, textAlign: 'center' }}>🔐</div>
      <div className="step-title">{props.t('chooseLoginTitle', 'Придумайте логин')}</div>
      <div className="step-sub">{props.t('chooseLoginSub', 'Юзернейм и пароль для входа')}</div>

      <div className="field">
        <label htmlFor="username">{props.t('username', 'Юзернейм')}</label>
        <input id="username" type="text" value={props.username} onChange={(event) => props.onUsernameChange(event.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} placeholder="@username" autoComplete="username" minLength={3} maxLength={32} />
      </div>
      <PasswordField id="password" label={props.t('password', 'Пароль')} onChange={props.onPasswordChange} onToggle={props.onTogglePassword} placeholder={props.t('passwordMin', 'Минимум 10 символов')} show={props.showPassword} value={props.password} />
      <div className="pw-strength"><div className="pw-strength-bar" style={strength} /></div>
      <PasswordField id="password2" label={props.t('repeatPassword', 'Повторите пароль')} onChange={props.onPasswordRepeatChange} onToggle={props.onTogglePasswordRepeat} placeholder={props.t('repeatPassword', 'Повторите пароль')} show={props.showPasswordRepeat} value={props.passwordRepeat} />

      <button className="btn-primary" type="button" onClick={props.onSubmit} disabled={props.isSubmitting}>
        {props.isSubmitting ? props.t('creatingAccount', 'Создание аккаунта...') : props.t('createAccount', 'Создать аккаунт')}
      </button>
      <div className="footer-link">
        {props.t('alreadyHaveAccount', 'Уже есть аккаунт?')} <a href={props.loginHref}>{props.t('login', 'Войти')}</a>
      </div>
    </section>
  );
}

function PasswordField({ id, label, onChange, onToggle, placeholder, show, value }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="new-password" style={{ paddingRight: 44 }} />
        <button className="eye-btn" type="button" onClick={onToggle}>
          <EyeIcon visible={show} />
        </button>
      </div>
    </div>
  );
}

function Feature({ icon, text }) {
  return (
    <div className="feature">
      <div className="feature-icon" style={{ background: 'rgba(255,0,127,0.15)' }}>{icon}</div>
      <span>{text}</span>
    </div>
  );
}

function ProgressDots({ activeIndex }) {
  return (
    <div className="dots">
      {[0, 1].map((index) => <div className={`dot ${index === activeIndex ? 'active' : ''}`} key={index} />)}
    </div>
  );
}

function BackButton({ onClick }) {
  return (
    <button className="btn-back" type="button" onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
    </button>
  );
}

function CameraIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>;
}

function EyeIcon({ visible }) {
  if (visible) {
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,0,127,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>;
  }

  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
}

function FragmentLine({ index, line }) {
  return <>{index > 0 ? <br /> : null}{line}</>;
}

function getPasswordScore(password) {
  return [
    password.length >= 10,
    password.length >= 10,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;
}

function getStrengthStyle(score) {
  const colors = ['#FF4B4B', '#FF8C00', '#FFD700', '#00C853', '#00E676'];
  const widths = ['20%', '40%', '60%', '80%', '100%'];
  return {
    background: score > 0 ? colors[score - 1] : 'transparent',
    width: score > 0 ? widths[score - 1] : '0%',
  };
}

function fallbackTranslate(_key, fallback) {
  return fallback;
}
