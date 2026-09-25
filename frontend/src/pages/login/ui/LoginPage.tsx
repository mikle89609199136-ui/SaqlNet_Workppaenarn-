import { useProfileStore } from '@/entities/user';
import { LoginForm } from '@/features/auth';
import { completeQrLogin, QrLoginPanel, QrScanLoginPanel } from '@/features/qr-login';
import { ROUTES } from '@/shared/config/routes';
import { AuthLayout, Button, Icon, SegmentedControl } from '@/shared/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';

export function LoginPage() {
  const token = useProfileStore((state) => state.token);
  const { t } = useTranslation();
  const [method, setMethod] = useState<'password' | 'qr'>('password');
  /* Два направления входа по QR: код показывает это устройство (#745)
     или это устройство сканирует код с вошедшего (#754). */
  const [qrDirection, setQrDirection] = useState<'show' | 'scan'>('show');

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
      {method === 'password' ? (
        <LoginForm />
      ) : qrDirection === 'show' ? (
        <div className="grid gap-3">
          <QrLoginPanel onConfirmed={completeQrLogin} />
          <Button className="w-full" onClick={() => setQrDirection('scan')} variant="ghost">
            <Icon name="camera" size="sm" />
            {t('login.scanOtherDevice', 'Отсканировать код с другого устройства')}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          <QrScanLoginPanel onConfirmed={completeQrLogin} />
          <Button className="w-full" onClick={() => setQrDirection('show')} variant="ghost">
            {t('login.showCodeHere', 'Показать код на этом устройстве')}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
