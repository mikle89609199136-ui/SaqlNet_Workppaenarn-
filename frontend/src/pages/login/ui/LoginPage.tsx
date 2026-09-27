import { useProfileStore } from '@/entities/user';
import { LoginForm } from '@/features/auth';
import { completeQrLogin, QrLoginPanel, QrScanLoginPanel } from '@/features/qr-login';
import { ROUTES } from '@/shared/config/routes';
import { AuthLayout, Icon, SegmentedControl } from '@/shared/ui';
import { useState, type ReactNode } from 'react';
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
      /* Код с шагами в карточку для формы не помещается: шаги рассыпаются
         в ленту, а код уезжает за край экрана. На широком экране карточка
         раздвигается, и шаги встают слева от кода. */
      className={method === 'qr' && qrDirection === 'show' ? 'md:w-[min(100%,760px)]' : undefined}
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
      {/* Смена вкладки или направления — новое содержимое проявляется, а
          карточка плавно меняет размер (AuthLayout). */}
      {method === 'password' ? (
        <div className="animate-fade-in" key="password">
          <LoginForm />
        </div>
      ) : qrDirection === 'show' ? (
        <div className="grid animate-fade-in gap-4" key="show">
          <QrLoginPanel onConfirmed={completeQrLogin} />
          <QrDirectionSwitch icon onClick={() => setQrDirection('scan')}>
            {t('login.scanOtherDevice', 'Отсканировать код с другого устройства')}
          </QrDirectionSwitch>
        </div>
      ) : (
        <div className="grid animate-fade-in gap-4" key="scan">
          <QrScanLoginPanel onConfirmed={completeQrLogin} />
          <QrDirectionSwitch onClick={() => setQrDirection('show')}>
            {t('login.showCodeHere', 'Показать код на этом устройстве')}
          </QrDirectionSwitch>
        </div>
      )}
    </AuthLayout>
  );
}

/**
 * Переход ко второму направлению входа по QR. Ссылкой, а не кнопкой во
 * всю ширину: это запасной путь, и на телефоне длинная подпись кнопки
 * ломалась на две строки с оторванной от текста иконкой.
 */
function QrDirectionSwitch({
  children,
  icon = false,
  onClick,
}: {
  children: ReactNode;
  icon?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="text-caption mx-auto inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-brand transition-colors duration-fast hover:underline focus-visible:outline-2 focus-visible:outline-brand"
      onClick={onClick}
      type="button"
    >
      {icon && <Icon name="camera" size="sm" />}
      {children}
    </button>
  );
}
