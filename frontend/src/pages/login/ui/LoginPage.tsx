import { useProfileStore } from '@/entities/user';
import { LoginForm } from '@/features/auth';
import { completeQrLogin, QrLoginPanel } from '@/features/qr-login';
import { ROUTES } from '@/shared/config/routes';
import { AuthLayout, SegmentedControl } from '@/shared/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';

export function LoginPage() {
  const token = useProfileStore((state) => state.token);
  const { t } = useTranslation();
  const [method, setMethod] = useState<'password' | 'qr'>('password');

  /* Уже вошли — на странице входа делать нечего. */
  if (token) return <Navigate replace to={ROUTES.CHATS} />;

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
      <SegmentedControl
        aria-label={t('login.method', 'Способ входа')}
        className="mb-5"
        onChange={(value) => setMethod(value as 'password' | 'qr')}
        options={[
          { label: t('login.byPassword', 'Пароль'), value: 'password' },
          { label: t('login.byQr', 'QR-код'), value: 'qr' },
        ]}
        value={method}
      />

      {/* Вход по QR переносит и ключи: история откроется без облачного
          пароля (#745). После сохранения сессии страница сама уйдёт в
          чаты — её перенаправляет проверка токена выше. */}
      {method === 'qr' ? <QrLoginPanel onConfirmed={completeQrLogin} /> : <LoginForm />}
    </AuthLayout>
  );
}
