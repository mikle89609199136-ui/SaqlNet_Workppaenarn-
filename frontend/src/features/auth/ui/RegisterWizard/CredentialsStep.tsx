import { useState } from 'react';
import type { UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Input } from '@/shared/ui';
import { getPasswordScore } from '@/shared/lib/passwordRules';
import { PasswordRequirements } from '../PasswordRequirements';
import { PasswordStrength } from './PasswordStrength';
import { PasswordToggle } from './PasswordToggle';
import type { TRegisterForm } from '../../model/registerSchema';

interface Props {
  errorOf: (field: keyof TRegisterForm) => string | undefined;
  password: string;
  register: UseFormRegister<TRegisterForm>;
}

export function CredentialsStep({ errorOf, password, register }: Props) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  const passwordScore = getPasswordScore(password);

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
