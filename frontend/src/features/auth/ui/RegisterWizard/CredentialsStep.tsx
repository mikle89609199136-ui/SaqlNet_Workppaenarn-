import { useEffect, useState, type ReactNode } from 'react';
import type { UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Icon, Input, Spinner } from '@/shared/ui';
import { getPasswordScore, MIN_PASSWORD_LENGTH } from '@/shared/lib';
import { checkUsernameQuery, MIN_USERNAME_LENGTH, USERNAME_PATTERN } from '@/entities/user';
import { PasswordRequirements } from '@/shared/ui';
import { PasswordStrength } from './PasswordStrength';
import { PasswordToggle } from './PasswordToggle';
import type { TRegisterForm } from '../../model/registerSchema';

export interface IUsernameValidationStatus {
  isTaken: boolean;
}

interface Props {
  errorOf: (field: keyof TRegisterForm) => string | undefined;
  password: string;
  username?: string;
  register: UseFormRegister<TRegisterForm>;
  onValidationChange?: (status: IUsernameValidationStatus) => void;
}

export function CredentialsStep({
  errorOf,
  password,
  username = '',
  register,
  onValidationChange,
}: Props) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  const [debouncedUsername, setDebouncedUsername] = useState(username);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUsername(username);
    }, 400);
    return () => clearTimeout(timer);
  }, [username]);

  const { data: usernameCheck, isFetching: isCheckingUsername } = useQuery(
    checkUsernameQuery(debouncedUsername)
  );

  const passwordScore = getPasswordScore(password);
  const usernameError = errorOf('username');

  const isFormatValid = USERNAME_PATTERN.test(username.trim());
  const isTyping = username !== debouncedUsername && username.trim().length >= MIN_USERNAME_LENGTH;
  const isChecking = Boolean(
    (isTyping || isCheckingUsername) &&
    isFormatValid &&
    username.trim().length >= MIN_USERNAME_LENGTH
  );
  const isTaken = Boolean(isFormatValid && usernameCheck && !usernameCheck.available);

  useEffect(() => {
    onValidationChange?.({ isTaken });
  }, [isTaken, onValidationChange]);

  let usernameHelperHint: string | undefined;
  let usernameHelperError: string | undefined = usernameError;
  let usernameAddon: ReactNode = null;

  if (!usernameError && isFormatValid && username.trim().length >= MIN_USERNAME_LENGTH) {
    if (isTyping || isCheckingUsername) {
      usernameHelperHint = t('register.usernameChecking', 'Проверка доступности имени...');
      usernameAddon = <Spinner size="sm" />;
    } else if (usernameCheck && !usernameCheck.available) {
      usernameHelperError = t('register.usernameTaken', 'Это имя пользователя занято');
      usernameAddon = <Icon className="text-danger" name="warning" size="sm" />;
    } else if (usernameCheck?.available) {
      usernameHelperHint = t('register.usernameAvailable', 'Имя пользователя свободно');
      usernameAddon = <Icon className="text-brand" name="check" size="sm" />;
    }
  }

  return (
    <>
      <Input
        addon={usernameAddon}
        autoCapitalize="none"
        autoComplete="username"
        autoCorrect="off"
        error={usernameHelperError}
        hint={
          usernameHelperHint ??
          t('register.usernameRules', 'Латинские буквы, цифры и _, от 3 до 32 символов')
        }
        label={t('username', 'Имя пользователя')}
        maxLength={32}
        /* «@» — сразу перед текстом, как в макете: отступ под значок был бы шире. */
        inputClassName="pl-8.5"
        placeholder="username"
        prefix="@"
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
          /* Число подставляется из правила, а не вписано в текст: вписанное
             уже разошлось с политикой — подсказка обещала шесть символов,
             тогда как список требований и схема требуют десять. */
          placeholder={t('passwordMin', {
            defaultValue: 'Минимум {{min}} символов',
            min: MIN_PASSWORD_LENGTH,
          })}
          type={showPassword ? 'text' : 'password'}
          {...register('password')}
        />
        <PasswordStrength score={passwordScore} />
        {/* Список нужен, пока человек печатает: сообщение об ошибке
            называет одно ближайшее требование, а видеть надо все. */}
        {password.length > 0 && <PasswordRequirements value={password} />}
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
