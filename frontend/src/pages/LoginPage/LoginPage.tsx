import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Icon, Input } from '@/components/ui';
import { AuthLayout } from '@/components/layouts';
import { ROUTES } from '@/consts/routes';
import { useToasts } from '@/hooks';
import { fetchUserSettings, saveAuthSession } from '@/services/authApi';
import { services } from '@/services/serviceContainer';
import { useProfileStore } from '@/store/profile';
import type { IAuthResponse } from '@/types';
import { loginFormSchema, type TLoginForm } from './loginSchema';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useProfileStore((state) => state.token);
  const { showToast } = useToasts();
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isSubmitted, touchedFields },
  } = useForm<TLoginForm>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { username: '', password: '' },
    /* Ругаться на пустое поле, которого человек ещё не касался, значит
       встретить его формой в ошибках. */
    mode: 'onTouched',
  });

  /* Уже вошли — на странице входа делать нечего. Раньше здесь стоял
     `window.location.href` прямо в теле компонента: перезагрузка всего
     приложения посреди отрисовки. */
  if (token) return <Navigate replace to={ROUTES.CHATS} />;

  /* Схема проверяет оба поля разом, поэтому набор в одном показывал бы
     претензию ко второму, ещё пустому. Ошибка появляется там, где
     человек уже побывал, либо после попытки войти. */
  const errorOf = (field: keyof TLoginForm) =>
    isSubmitted || touchedFields[field] ? errors[field]?.message : undefined;

  async function submit(values: TLoginForm) {
    try {
      const data: IAuthResponse = await services.authService.login({
        password: values.password,
        username: values.username.trim(),
      });

      /* Второй пароль сервер ещё принимает, но интерфейса у него больше
         нет — включить защиту негде. Если она всё же включена (осталась
         с прежних времён или выставлена через API), человек должен
         увидеть причину, а не форму, которая молча ничего не делает. */
      if (data.twoFARequired) {
        setError('password', {
          message: t(
            'login.twoFAUnavailable',
            'У аккаунта включён дополнительный пароль — вход с ним сейчас недоступен'
          ),
        });
        return;
      }

      if (!data.token) {
        throw new Error(t('invalidResponse', 'Неверный формат ответа'));
      }

      const settings = await fetchUserSettings();
      saveAuthSession({ settings, token: data.token, user: data.user! });
      navigate(safeReturnPath(searchParams.get('from')), { replace: true });
    } catch (error) {
      const code = (error as { data?: { code?: string } })?.data?.code;

      /* Неверная пара — это про оба поля сразу, поэтому подпись под
         паролем, а фокус туда же: имя человек, как правило, помнит.
         Раньше об этом сообщал тост: он исчезал через пару секунд, а
         форма оставалась заполненной, будто ничего не произошло. */
      if (code === 'invalid_credentials') {
        setError(
          'password',
          { message: t('login.invalidCredentials', 'Неверное имя пользователя или пароль') },
          { shouldFocus: true }
        );
        return;
      }

      showToast('error', (error as Error).message);
    }
  }

  return (
    <AuthLayout
      footer={
        <>
          {t('noAccount', 'Нет аккаунта?')}{' '}
          <Link className="text-brand hover:underline" to={ROUTES.REGISTER}>
            {t('registerAction', 'Зарегистрироваться')}
          </Link>
        </>
      }
      subtitle={t('loginSubtitle', 'Войдите в аккаунт')}
      title="CraneApp"
    >
      <form className="grid gap-4 text-left" noValidate onSubmit={handleSubmit(submit)}>
        <Input
          autoCapitalize="none"
          autoComplete="username"
          autoCorrect="off"
          error={errorOf('username')}
          label={t('username', 'Имя пользователя')}
          placeholder="@username.123"
          {...register('username')}
        />

        <Input
          addon={
            <button
              aria-label={
                showPassword
                  ? t('hidePassword', 'Скрыть пароль')
                  : t('showPassword', 'Показать пароль')
              }
              className="text-ink-2 transition-colors hover:text-ink"
              onClick={() => setShowPassword((value) => !value)}
              type="button"
            >
              <Icon name={showPassword ? 'eyeOff' : 'eye'} size="md" />
            </button>
          }
          autoComplete="current-password"
          error={errorOf('password')}
          label={t('password', 'Пароль')}
          placeholder="••••••••"
          type={showPassword ? 'text' : 'password'}
          {...register('password')}
        />

        <Button className="mt-2 w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? t('loginLoading', 'Вход...') : t('login', 'Войти')}
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * Куда вернуть человека после входа.
 *
 * `AuthGuard`, выкидывая на вход, дописывает `?from=` — чтобы после
 * входа человек оказался там, где его прервали. Значение приходит из
 * адресной строки, поэтому проверяется: внутренний путь начинается с
 * одной косой черты. `//example.com` — это уже чужой сайт, и переход
 * туда был бы открытым перенаправлением.
 */
function safeReturnPath(from: string | null): string {
  if (!from || !from.startsWith('/') || from.startsWith('//')) return ROUTES.CHATS;
  return from;
}
