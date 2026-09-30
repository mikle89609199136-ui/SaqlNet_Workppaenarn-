import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useProfileStore } from '@/entities/user';
import { completeQrLogin, QrClaimPanel } from '@/features/qr-login';
import { REACT_ROUTES } from '@/shared/config';
import { parseQrOfferFragment } from '@/shared/crypto';
import { AuthLayout, Banner, Button } from '@/shared/ui';

/**
 * Ссылку из кода забираем из адреса один раз и сразу убираем её оттуда:
 * токен и ключ подписи не должны оставаться в истории браузера.
 */
function takeLink() {
  const link = parseQrOfferFragment(window.location.hash);
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return link;
}

/**
 * Вход на новом устройстве по коду с вошедшего (#754).
 *
 * Сюда камера телефона открывает ссылку из кода, который показывает
 * вошедшее устройство. Страница вне AuthGuard: входит тот, у кого сессии
 * ещё нет.
 */
export function QrClaimPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  /* Смотрим на сессию только при открытии: вход по коду сам сохраняет
     профиль ещё до конца, и живая подписка показала бы «вы уже вошли»
     посреди входа. */
  const [signedIn] = useState(() => useProfileStore.getState().isAuth);
  const [link] = useState(takeLink);
  const [finished, setFinished] = useState(false);

  /* Вход завершился — дальше чаты. Уже вошедшему здесь делать нечего,
     и код лучше не занимать: его ждёт другое устройство. */
  if (finished) return <Navigate replace to={REACT_ROUTES.CHATS} />;

  return (
    <AuthLayout
      footer={
        <Link className="text-brand hover:underline" to={REACT_ROUTES.LOGIN}>
          {t('qrClaim.otherWays', 'Другие способы входа')}
        </Link>
      }
      title={t('qrClaim.title', 'Вход по коду с другого устройства')}
    >
      {signedIn ? (
        <div className="grid gap-4">
          <Banner icon="info" tone="info">
            {t(
              'qrClaim.alreadySignedIn',
              'На этом устройстве вы уже вошли. Код нужен устройству, где входа ещё нет.'
            )}
          </Banner>
          <Button className="w-full" onClick={() => navigate(REACT_ROUTES.CHATS)}>
            {t('link.openApp', 'Открыть CraneApp')}
          </Button>
        </div>
      ) : link ? (
        <QrClaimPanel
          link={link}
          onConfirmed={async (result) => {
            await completeQrLogin(result);
            setFinished(true);
          }}
          onRetry={() => navigate(REACT_ROUTES.LOGIN)}
        />
      ) : (
        <Banner icon="warning" tone="warn">
          {t('qrLogin.invalidLink', 'Это не код входа в CraneApp')}
        </Banner>
      )}
    </AuthLayout>
  );
}
