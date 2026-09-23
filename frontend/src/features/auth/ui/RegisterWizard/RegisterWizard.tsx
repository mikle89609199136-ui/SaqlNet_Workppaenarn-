import { zodResolver } from '@hookform/resolvers/zod';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout, Button, showToast } from '@/shared/ui';
import { type TLanguage } from '@/shared/i18n/languages';
import { ROUTES } from '@/shared/config/routes';
import { saveAuthSession, uploadAvatar } from '@/services/authApi';
import { services } from '@/services/serviceContainer';
import { validateAvatarFile } from '@/entities/user';
import type { IAuthResponse } from '@/types';
import {
  registerFormSchema,
  REGISTER_STEPS,
  STEP_FIELDS,
  type TRegisterForm,
  type TRegisterStep,
} from '../../model/registerSchema';
import { StepHeader } from './StepHeader';
import { WelcomeStep } from './WelcomeStep';
import { AboutStep } from './AboutStep';
import { CredentialsStep, type IUsernameValidationStatus } from './CredentialsStep';

export function RegisterWizard() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [step, setStep] = useState<TRegisterStep>('welcome');
  /* Язык уже определён по браузеру при запуске (shared/i18n) — здесь
     его только показывают и дают поправить. Выбранный тут же меняет
     интерфейс мастера и вместе с ним уходит на сервер. */
  const language = (i18n.language.split('-')[0] as TLanguage) ?? 'ru';
  /* Пытались ли уже уйти с текущего шага — кнопкой «Продолжить» или
     отправкой формы. Пока не пытались, пустые поля не считаются
     ошибкой: человек до них просто не дошёл. */
  const [attempted, setAttempted] = useState(false);
  const [avatar, setAvatar] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<IUsernameValidationStatus>({
    isChecking: false,
    isTaken: false,
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    getValues,
    handleSubmit,
    reset,
    setError,
    trigger,
    watch,
    formState: { errors, isSubmitting, touchedFields },
  } = useForm<TRegisterForm>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { firstName: '', lastName: '', username: '', password: '', passwordRepeat: '' },
    mode: 'onTouched',
  });

  /* Схема проверяет объект целиком, поэтому стоит тронуть одно поле —
     и в состоянии формы оказываются ошибки всех остальных, ещё пустых.
     Показываем ошибку только там, где человек уже побывал, либо куда
     его не пустили: иначе он видит претензии к тому, чего не делал. */
  const errorOf = (field: keyof TRegisterForm) =>
    attempted || touchedFields[field] ? errors[field]?.message : undefined;

  /**
   * Вперёд пускают, только пройдя проверку текущего шага; назад — всегда
   * и без проверок. Значения при этом никуда не деваются: форма одна на
   * все шаги, а меняется лишь то, что показано.
   */
  async function goNext() {
    const fields = STEP_FIELDS[step];
    if (fields.length && !(await trigger(fields))) {
      setAttempted(true);
      return;
    }

    const next = REGISTER_STEPS[REGISTER_STEPS.indexOf(step) + 1];
    if (next) goToStep(next);
  }

  function goBack() {
    const previous = REGISTER_STEPS[REGISTER_STEPS.indexOf(step) - 1];
    if (previous) goToStep(previous);
  }

  /**
   * Отправка формы — это всегда «дальше по шагу».
   *
   * Кнопка на всех шагах одна и та же, `type="submit"`, поэтому Enter в
   * поле работает как нажатие на неё — так человек и ожидает. Раньше
   * кнопка меняла тип с `button` на `submit` при переходе, и React успевал
   * подменить её между нажатием и отпусканием мыши: отпускание приходилось
   * уже на кнопку отправки, форма уходила на проверку сама и встречала
   * человека ошибками на шаге, куда он только что пришёл.
   */
  const handleStepSubmit =
    step === 'credentials'
      ? handleSubmit(submit, () => setAttempted(true))
      : withPreventDefault(goNext);

  /**
   * Шаг открывается с чистого листа, но с набранным.
   *
   * `reset` со значениями сбрасывает отметки о касаниях, ошибки и
   * признак отправки — иначе они переезжают между шагами: попытка
   * отправить пустую форму помечает тронутыми все поля разом, и после
   * возврата назад человек снова видел бы претензии к тому, чего не
   * заполнял. Значения при этом остаются на месте — ради них форма и
   * держится одна на весь мастер.
   */
  function goToStep(next: TRegisterStep) {
    reset(getValues());
    setAttempted(false);
    setUsernameStatus({ isChecking: false, isTaken: false });
    setStep(next);
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const validation = validateAvatarFile(file);
    if (!validation.valid) {
      const errorMessage =
        validation.errorCode === 'tooLarge'
          ? t('settings.profile.avatarTooLarge', 'Файл слишком большой. Максимальный размер 5 МБ')
          : t(
              'settings.profile.avatarInvalidType',
              'Поддерживаются только изображения (JPEG, PNG, WebP, GIF)'
            );
      showToast('error', errorMessage);
      return;
    }

    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (readerEvent) => setAvatar(String(readerEvent.target?.result || ''));
    reader.readAsDataURL(file);
  }

  async function submit(values: TRegisterForm) {
    if (usernameStatus.isTaken) {
      setStep('credentials');
      setError(
        'username',
        { message: t('register.usernameTaken', 'Это имя пользователя занято') },
        { shouldFocus: true }
      );
      return;
    }
    if (usernameStatus.isChecking) {
      return;
    }

    try {
      const data: IAuthResponse = await services.authService.register({
        firstName: values.firstName.trim(),
        language,
        lastName: values.lastName.trim(),
        password: values.password,
        username: values.username.trim(),
      });

      if (!data.token) {
        throw new Error(t('invalidResponse', 'Неверный формат ответа'));
      }

      saveAuthSession({ settings: undefined, token: data.token, user: data.user! });
      /* Фотография не должна ронять регистрацию: аккаунт уже создан, и
         неудачная загрузка значит лишь аватарку по умолчанию. */
      if (avatarFile) {
        await uploadAvatar(avatarFile).catch(() => {});
      }

      showToast('success', t('welcomeDone', 'Добро пожаловать!'));
      navigate(ROUTES.CHATS, { replace: true });
    } catch (error) {
      const code = (error as { data?: { code?: string } })?.data?.code;

      /* Занятое имя — ошибка своего поля, и человека надо вернуть
         на тот шаг, где это поле есть. Раньше об этом сообщал тост, а
         форма оставалась заполненной, будто всё прошло. */
      /* Пароль сервер проверяет своей политикой, и она может оказаться
         строже нашей копии — например, после правки на сервере, о
         которой клиент ещё не знает. Тогда ошибка должна встать у поля
         пароля, а не улететь общим тостом. */
      if (code === 'weak_password') {
        setStep('credentials');
        setError(
          'password',
          { message: t('register.weakPassword', 'Пароль не отвечает требованиям') },
          { shouldFocus: true }
        );
        return;
      }

      if (code === 'username_taken' || code === 'user_exists') {
        setStep('credentials');
        setError(
          'username',
          { message: t('register.usernameTaken', 'Это имя пользователя занято') },
          { shouldFocus: true }
        );
        return;
      }

      showToast('error', (error as Error).message);
    }
  }

  const loginLink = (
    <>
      {t('alreadyHaveAccount', 'Уже есть аккаунт?')}{' '}
      <Link className="text-brand hover:underline" to={ROUTES.LOGIN}>
        {t('login', 'Войти')}
      </Link>
    </>
  );

  if (step === 'welcome') {
    return (
      <AuthLayout footer={loginLink} title={t('welcomeRegisterTitle', 'Добро пожаловать')}>
        <WelcomeStep
          language={language}
          onLanguageChange={(value) => void i18n.changeLanguage(value)}
          onNext={goNext}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      footer={step === 'credentials' ? loginLink : undefined}
      header={<StepHeader activeIndex={step === 'about' ? 0 : 1} onBack={goBack} />}
      title=""
    >
      <form className="grid gap-4 text-left" noValidate onSubmit={handleStepSubmit}>
        {step === 'about' ? (
          <AboutStep
            avatar={avatar}
            avatarInputRef={avatarInputRef}
            errorOf={errorOf}
            onAvatarChange={handleAvatarChange}
            register={register}
          />
        ) : (
          <CredentialsStep
            errorOf={errorOf}
            onValidationChange={setUsernameStatus}
            password={watch('password')}
            register={register}
            username={watch('username')}
          />
        )}

        <Button
          className="mt-2 w-full"
          disabled={
            isSubmitting ||
            (step === 'credentials' && (usernameStatus.isChecking || usernameStatus.isTaken))
          }
          type="submit"
        >
          {step === 'about'
            ? t('continueAction', 'Продолжить')
            : isSubmitting
              ? t('creatingAccount', 'Создание аккаунта...')
              : t('createAccount', 'Создать аккаунт')}
        </Button>
      </form>
    </AuthLayout>
  );
}

/* Отправка формы шага, которому нужен только переход вперёд. */
function withPreventDefault(action: () => void) {
  return (event: FormEvent) => {
    event.preventDefault();
    action();
  };
}
