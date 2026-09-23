import { useEffect, useState, type ReactNode } from 'react';
import type { UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Icon, Input, Spinner } from '@/shared/ui';
import { getPasswordScore, MIN_PASSWORD_LENGTH } from '@/shared/lib';
import { checkUsernameQuery, USERNAME_PATTERN } from '@/entities/user';
import { PasswordRequirements } from '../PasswordRequirements';
import { PasswordStrength } from './PasswordStrength';
import { PasswordToggle } from './PasswordToggle';
import type { TRegisterForm } from '../../model/registerSchema';

export interface IUsernameValidationStatus {
  isChecking: boolean;
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
  const isTyping = username !== debouncedUsername && username.trim().length >= 3;
  const isChecking = Boolean((isTyping || isCheckingUsername) && isFormatValid && username.trim().length >= 3);
  const isTaken = Boolean(isFormatValid && usernameCheck && !usernameCheck.available);

  useEffect(() => {
    onValidationChange?.({ isChecking, isTaken });
  }, [isChecking, isTaken, onValidationChange]);

  let usernameHelperHint: string | undefined;
  let usernameHelperError: string | undefined = usernameError;
  let usernameAddon: ReactNode = null;

  if (!usernameError && isFormatValid && username.trim().length >= 3) {
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
      <div className="text-center">
        <h2 className="text-title font-semibold text-ink">
          {t('chooseLoginTitle', 'Придумайте логин')}
        </h2>
        <p className="mt-1 text-caption text-ink-2">
          {t('chooseLoginSub', 'Имя пользователя и пароль для входа')}
        </p>
      </div>

      <Input
        addon={usernameAddon}
        autoCapitalize="none"
        autoComplete="username"
        autoCorrect="off"
        error={usernameHelperError}
        hint={usernameHelperHint}
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
          placeholder={t('passwordMin', {
            defaultValue: 'Минимум {{min}} символов',
            min: MIN_PASSWORD_LENGTH,
          })}
          type={showPassword ? 'text' : 'password'}
          {...register('password')}
        />
        <PasswordStrength score={passwordScore} />
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
