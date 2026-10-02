import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { useProfileStore } from '@/entities/user';
import { LinkDevicePanel } from '@/features/qr-login';
import { REACT_ROUTES } from '@/shared/config';
import { AuthLayout, Button } from '@/shared/ui';

const PENDING_LINK_KEY = 'craneapp:pending-qr-link';

/**
 * Ссылку из QR забираем из адреса один раз и сразу убираем её оттуда:
 * токен и ключ не должны оставаться в истории браузера. Если человек ещё
 * не вошёл, ссылка ждёт его в памяти вкладки — после входа он вернётся
 * сюда, а фрагмент адреса этот путь не переживает.
 */
function takeLink(): string | null {
  if (window.location.hash) {
    const link = window.location.href;
    try {
      sessionStorage.setItem(PENDING_LINK_KEY, link);
    } catch {
      // Хранилище закрыто — обойдёмся ссылкой из адреса.
    }
    window.history.replaceState(null, '', window.location.pathname);
    return link;
  }

  try {
    return sessionStorage.getItem(PENDING_LINK_KEY);
  } catch {
    return null;
  }
}

function forgetLink() {
  try {
    sessionStorage.removeItem(PENDING_LINK_KEY);
  } catch {
    // нечего забывать
  }
}

/**
 * Подтверждение входа нового устройства (#745).
 *
 * Сюда камера телефона открывает ссылку из QR-кода.
 */
export function LinkPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signedIn = useProfileStore((state) => state.isAuth);
  const [link] = useState(takeLink);

  useEffect(() => {
    // Код одноразовый и живёт пять минут: хранить его дольше незачем.
    if (signedIn) return forgetLink;
  }, [signedIn]);

  if (!signedIn) {
    return (
      <Navigate
        replace
        to={`${REACT_ROUTES.LOGIN}?from=${encodeURIComponent(REACT_ROUTES.LINK)}`}
      />
    );
  }

  return (
    <AuthLayout
      footer={
        <Button onClick={() => navigate(REACT_ROUTES.CHATS)} size="sm" variant="ghost">
          {t('link.openApp', 'Открыть CraneApp')}
        </Button>
      }
      title={t('keyBackup.settings.linkDevice', 'Подключить устройство')}
    >
      <LinkDevicePanel initialLink={link} onDone={() => navigate(REACT_ROUTES.CHATS)} />
    </AuthLayout>
  );
}
