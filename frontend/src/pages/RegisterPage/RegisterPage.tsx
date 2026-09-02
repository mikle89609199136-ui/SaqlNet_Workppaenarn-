import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState } from 'react';
import { useForm, type UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layouts';
import { Button, Icon, Input } from '@/components/ui';
import { ROUTES } from '@/consts/routes';
import { STORAGE_KEYS } from '@/consts/storageKeys';
import { useToasts } from '@/hooks';
import { saveAuthSession, uploadAvatar } from '@/services/authApi';
import { services } from '@/services/serviceContainer';
import { useProfileStore } from '@/store/profile';
import type { IAuthResponse } from '@/types';
import {
  getPasswordScore,
  registerFormSchema,
  REGISTER_STEPS,
  STEP_FIELDS,
  type TRegisterForm,
  type TRegisterStep,
} from './registerSchema';

export function RegisterPage() {
  const navigate = useNavigate();
  const token = useProfileStore((state) => state.token);
  const { showToast } = useToasts();
  const { t, i18n } = useTranslation();

  const [step, setStep] = useState<TRegisterStep>('welcome');
  /* Пытались ли уже уйти с текущего шага — кнопкой «Продолжить» или
     отправкой формы. Пока не пытались, пустые поля не считаются
     ошибкой: человек до них просто не дошёл. */
  const [attempted, setAttempted] = useState(false);
  const [avatar, setAvatar] = useState('');
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
    defaultValues: { firstName: '', username: '', password: '', passwordRepeat: '' },
    mode: 'onTouched',
  });

  if (token) return <Navigate replace to={ROUTES.CHATS} />;

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
    setStep(next);
  }

  function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (readerEvent) => setAvatar(String(readerEvent.target?.result || ''));
    reader.readAsDataURL(file);
  }

  async function submit(values: TRegisterForm) {
    try {
      const language = i18n.language || localStorage.getItem(STORAGE_KEYS.LANGUAGE) || 'ru';
      const data: IAuthResponse = await services.authService.register({
        firstName: values.firstName.trim(),
        language,
        lastName: '',
        password: values.password,
        username: values.username.trim(),
      });

      if (!data.token) {
        throw new Error(t('invalidResponse', 'Неверный формат ответа'));
      }

      saveAuthSession({ settings: undefined, token: data.token, user: data.user! });
      /* Фотография не должна ронять регистрацию: аккаунт уже создан, и
         неудачная загрузка значит лишь аватарку по умолчанию. Полноценная
         загрузка через медиа-сервис делается в #485. */
      await uploadAvatar(avatar).catch(() => {});

      showToast('success', t('welcomeDone', 'Добро пожаловать!'));
      navigate(ROUTES.CHATS, { replace: true });
    } catch (error) {
      const code = (error as { data?: { code?: string } })?.data?.code;

      /* Занятое имя — ошибка своего поля, и человека надо вернуть
         на тот шаг, где это поле есть. Раньше об этом сообщал тост, а
         форма оставалась заполненной, будто всё прошло. */
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
        <WelcomeFeatures />
        <Button className="mt-6 w-full" onClick={goNext} type="button">
          {t('createAccount', 'Создать аккаунт')}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      footer={step === 'credentials' ? loginLink : undefined}
      header={<StepHeader activeIndex={step === 'name' ? 0 : 1} onBack={goBack} />}
      title=""
    >
      <form className="grid gap-4 text-left" noValidate onSubmit={handleStepSubmit}>
        {step === 'name' ? (
          <NameStep
            avatar={avatar}
            avatarInputRef={avatarInputRef}
            errorOf={errorOf}
            onAvatarChange={handleAvatarChange}
            register={register}
          />
        ) : (
          <CredentialsStep
            errorOf={errorOf}
            passwordScore={getPasswordScore(watch('password'))}
            register={register}
          />
        )}

        <Button className="mt-2 w-full" disabled={isSubmitting} type="submit">
          {step === 'name'
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
  return (event: React.FormEvent) => {
    event.preventDefault();
    action();
  };
}

/* Шапка шагов: возврат назад и точки хода. Логотип на этих экранах не
   нужен — человек уже внутри, ему важно видеть, где он и как вернуться. */
function StepHeader({ activeIndex, onBack }: { activeIndex: number; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mb-5 flex items-center gap-3">
      <button
        aria-label={t('back', 'Назад')}
        className="-ml-2 rounded-control p-1.5 text-ink-2 transition-colors duration-fast hover:bg-sheet-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        onClick={onBack}
        type="button"
      >
        <Icon className="rotate-180" name="chevronRight" size="md" />
      </button>
      <div className="flex flex-1 justify-center gap-2" aria-hidden>
        {[0, 1].map((index) => (
          <span
            className={
              index === activeIndex
                ? 'h-1.5 w-6 rounded-pill bg-brand'
                : 'h-1.5 w-1.5 rounded-pill bg-line'
            }
            key={index}
          />
        ))}
      </div>
      {/* Уравновешивает кнопку слева, чтобы точки стояли по центру. */}
      <span className="w-8" />
    </div>
  );
}

function WelcomeFeatures() {
  const { t } = useTranslation();
  const features = [
    { icon: '🔒', text: t('welcomeFeatureE2E', 'End-to-end шифрование всех сообщений') },
    { icon: '⚡️', text: t('welcomeFeatureDelivery', 'Мгновенная доставка в любой точке мира') },
    { icon: '🎨', text: t('welcomeFeatureMedia', 'Голосовые, видео, стикеры и многое другое') },
    { icon: '🛡️', text: t('welcomeFeaturePrivacy', 'Полная защита данных и приватность') },
  ];

  return (
    <ul className="grid gap-3 text-left">
      {features.map(({ icon, text }) => (
        <li className="flex items-center gap-3" key={text}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-brand-soft">
            {icon}
          </span>
          <span className="text-caption text-ink-2">{text}</span>
        </li>
      ))}
    </ul>
  );
}

interface IStepProps {
  errorOf: (field: keyof TRegisterForm) => string | undefined;
  register: UseFormRegister<TRegisterForm>;
}

function NameStep({
  avatar,
  avatarInputRef,
  errorOf,
  onAvatarChange,
  register,
}: IStepProps & {
  avatar: string;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  onAvatarChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className="text-center">
        <h2 className="text-title font-semibold text-ink">
          {t('whatIsYourName', 'Как вас зовут?')}
        </h2>
        <p className="mt-1 text-caption text-ink-2">
          {t('addPhotoName', 'Добавьте фото и введите своё имя')}
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          className="relative h-24 w-24 overflow-hidden rounded-full border-2 border-dashed border-line bg-sheet-2 transition-colors hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand data-[filled=true]:border-solid data-[filled=true]:border-brand"
          data-filled={Boolean(avatar)}
          onClick={() => avatarInputRef.current?.click()}
          type="button"
        >
          {avatar ? (
            <img alt="" className="h-full w-full object-cover" src={avatar} />
          ) : (
            <Icon className="mx-auto text-ink-3" name="camera" size="lg" />
          )}
        </button>
        <span className="text-caption text-ink-3">
          {t('tapAddPhoto', 'Нажмите чтобы добавить фото')}
        </span>
        <input
          accept="image/*"
          className="hidden"
          onChange={onAvatarChange}
          ref={avatarInputRef}
          type="file"
        />
      </div>

      <Input
        autoComplete="given-name"
        error={errorOf('firstName')}
        label={t('firstName', 'Имя')}
        maxLength={64}
        placeholder={t('firstNamePlaceholder', 'Ваше имя')}
        {...register('firstName')}
      />
    </>
  );
}

function CredentialsStep({
  errorOf,
  passwordScore,
  register,
}: IStepProps & { passwordScore: number }) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);

  return (
    <>
      <div className="text-center">
        <h2 className="text-title font-semibold text-ink">
          {t('chooseLoginTitle', 'Придумайте логин')}
        </h2>
        <p className="mt-1 text-caption text-ink-2">
          {t('chooseLoginSub', 'Имя пользователя и пароль для входа')}
        </p>
      </div>

      <Input
        autoCapitalize="none"
        autoComplete="username"
        autoCorrect="off"
        error={errorOf('username')}
        label={t('username', 'Имя пользователя')}
        maxLength={32}
        placeholder="@username"
        {...register('username')}
      />

      <div>
        <Input
          addon={
            <PasswordToggle
              onToggle={() => setShowPassword((value) => !value)}
              shown={showPassword}
            />
          }
          autoComplete="new-password"
          error={errorOf('password')}
          label={t('password', 'Пароль')}
          placeholder={t('passwordMin', 'Минимум 6 символов')}
          type={showPassword ? 'text' : 'password'}
          {...register('password')}
        />
        <PasswordStrength score={passwordScore} />
      </div>

      <Input
        addon={
          <PasswordToggle onToggle={() => setShowRepeat((value) => !value)} shown={showRepeat} />
        }
        autoComplete="new-password"
        error={errorOf('passwordRepeat')}
        label={t('repeatPassword', 'Повторите пароль')}
        type={showRepeat ? 'text' : 'password'}
        {...register('passwordRepeat')}
      />
    </>
  );
}

function PasswordToggle({ onToggle, shown }: { onToggle: () => void; shown: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      aria-label={shown ? t('hidePassword', 'Скрыть пароль') : t('showPassword', 'Показать пароль')}
      className="text-ink-2 transition-colors hover:text-ink"
      onClick={onToggle}
      type="button"
    >
      <Icon name={shown ? 'eyeOff' : 'eye'} size="md" />
    </button>
  );
}

/* Полоска силы пароля. Цвета — от опасного к безопасному, целиком на
   токенах: два опорных и три ступени между ними. */
function PasswordStrength({ score }: { score: number }) {
  const colors = [
    'var(--color-danger)',
    'color-mix(in srgb, var(--color-danger) 50%, var(--color-warn))',
    'var(--color-warn)',
    'color-mix(in srgb, var(--color-warn) 45%, var(--color-ok))',
    'var(--color-ok)',
  ];

  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-pill bg-line-soft" aria-hidden>
      <div
        className="h-full transition-all duration-normal"
        style={{
          background: score > 0 ? colors[score - 1] : 'transparent',
          width: score > 0 ? `${score * 20}%` : '0%',
        }}
      />
    </div>
  );
}
