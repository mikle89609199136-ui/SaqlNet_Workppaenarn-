import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Icon, Input, showToast } from '@/shared/ui';
import { safeReturnPath } from '../model/safeReturnPath';
import { fetchUserSettings, saveAuthSession } from '@/services/authApi';
import { services } from '@/services/serviceContainer';
import { rememberLoginPassword } from '@/shared/crypto';
import type { IAuthResponse } from '@/types';
import { createLoginFormSchema, type TLoginForm } from '../model/loginSchema';

export function LoginForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  /* Сообщения схемы — на языке интерфейса: сменился язык — новая схема. */
  const schema = useMemo(() => createLoginFormSchema(t), [t]);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting, isSubmitted, touchedFields },
  } = useForm<TLoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
    /* Ругаться на пустое поле, которого человек ещё не касался, значит
       встретить его формой в ошибках. */
    mode: 'onTouched',
  });

  /* Схема проверяет оба поля разом, поэтому набор в одном показывал бы
     претензию ко второму, ещё пустому. Ошибка появляется там, где
     человек уже побывал, либо после попытки войти. */
  const errorOf = (field: keyof TLoginForm) =>
    isSubmitted || touchedFields[field] ? errors[field]?.message : undefined;

  const usernameRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const usernameField = register('username');
  const passwordField = register('password');

  /* Курсор сразу в форме — иначе Enter некуда отправить: браузер
     отправляет форму по Enter, только когда фокус в её поле. Это ровно
     случай автозаполнения: логин и пароль подставлены, человек ничего не
     нажимал и жмёт Enter — фокус на странице, и ничего не происходит.
     Логин уже подставлен — курсор в пароль, следующий шаг там.

     Только с мышью (pointer: fine): на телефоне фокус открыл бы клавиатуру
     поверх половины экрана входа, а в поле там человек встаёт сам. */
  useEffect(() => {
    if (!window.matchMedia?.('(pointer: fine)').matches) return;
    const target = usernameRef.current?.value ? passwordRef.current : usernameRef.current;
    target?.focus();
  }, []);

  /* Значения — из самих полей. Автозаполнение не всегда присылает событие
     ввода, и форма считала бы поля пустыми, хотя в них логин и пароль. */
  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    for (const [name, input] of [
      ['username', usernameRef.current],
      ['password', passwordRef.current],
    ] as const) {
      if (input) setValue(name, input.value);
    }
    return handleSubmit(submit)(event);
  };

  async function submit(values: TLoginForm) {
    try {
      const data: IAuthResponse = await services.authService.login({
        password: values.password,
        // «@» в начале набирают по привычке — сервер ждёт имя без него.
        username: values.username.trim().replace(/^@/, ''),
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

      if (!data.user) {
        throw new Error(t('invalidResponse', 'Неверный формат ответа'));
      }

      const settings = await fetchUserSettings();
      // Облачный пароль не должен совпасть с этим: его знает сервер.
      await rememberLoginPassword(values.password);
      saveAuthSession({ settings, user: data.user });
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
    <form className="grid gap-4 text-left" noValidate onSubmit={submitForm}>
      <Input
        autoCapitalize="none"
        autoComplete="username"
        autoCorrect="off"
        error={errorOf('username')}
        label={t('username', 'Имя пользователя')}
        /* «@» — префиксом, как в регистрации (#827), а не в подсказке. */
        inputClassName="pl-8.5"
        placeholder="username"
        prefix="@"
        {...usernameField}
        ref={(element) => {
          usernameField.ref(element);
          usernameRef.current = element;
        }}
      />

      <Input
        addon={
          <button
            aria-label={
              showPassword
                ? t('hidePassword', 'Скрыть пароль')
                : t('showPassword', 'Показать пароль')
            }
            className="flex size-10 cursor-pointer items-center justify-center rounded-field text-ink-3 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
            onClick={() => setShowPassword((value) => !value)}
            type="button"
          >
            <Icon className="stroke-[1.8px]" name={showPassword ? 'eyeOff' : 'eye'} size="md" />
          </button>
        }
        autoComplete="current-password"
        error={errorOf('password')}
        label={t('password', 'Пароль')}
        placeholder="••••••••"
        type={showPassword ? 'text' : 'password'}
        {...passwordField}
        ref={(element) => {
          passwordField.ref(element);
          passwordRef.current = element;
        }}
      />

      <Button className="mt-2 w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? t('loginLoading', 'Вход...') : t('login', 'Войти')}
      </Button>
    </form>
  );
}
