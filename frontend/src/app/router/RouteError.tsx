import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useRouteError } from 'react-router-dom';
import { Button, ErrorScreen } from '@/shared/ui';
import { REACT_ROUTES } from '@/shared/config/routes';
import { routeErrorKind, type TRouteErrorKind } from './routeErrorKind';

/**
 * Экраны ошибок маршрутов (#1071).
 *
 * Без них React Router рисовал на месте всего приложения свой экран —
 * по-английски «Unexpected Application Error!», «500» или стек и ни одной
 * кнопки, — а ошибка в одном чате уносила и список чатов.
 */

interface IRouteErrorProps {
  /** Перезагрузить страницу. Параметром — для тестов. */
  reload?: () => void;
  /** Есть ли сеть. Параметром — для тестов. */
  isOnline?: () => boolean;
}

const reloadPage = () => window.location.reload();
const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

function useRouteErrorKind(reload: () => void, isOnline: () => boolean): TRouteErrorKind {
  const error = useRouteError();
  const kind = routeErrorKind(error, isOnline());

  // Стандартный экран писал ошибку в консоль только в dev-сборке.
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Без сети ждать нечего, кроме самой сети: вернулась — перезагружаемся.
  useEffect(() => {
    if (kind !== 'offline') return undefined;
    window.addEventListener('online', reload, { once: true });
    return () => window.removeEventListener('online', reload);
  }, [kind, reload]);

  return kind;
}

/* Тексты — с запасными строками и без Suspense, как у RouteLoadingFallback:
   экран обязан показаться и тогда, когда переводы не загрузились. */
function useScreenTranslation() {
  return useTranslation(undefined, { useSuspense: false }).t;
}

/** Всё окно: ошибка при запуске, в загрузчике сессии или в отрисовке. */
export function RootRouteError({
  reload = reloadPage,
  isOnline = browserOnline,
}: IRouteErrorProps) {
  const t = useScreenTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const kind = useRouteErrorKind(reload, isOnline);
  const offline = kind === 'offline';
  // У первой записи истории ключ «default»: назад из приложения некуда.
  const canGoBack = location.key !== 'default';

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-ground p-6">
      <ErrorScreen
        actions={
          <>
            <Button onClick={reload} type="button">
              {t('errorScreen.reload', 'Перезагрузить')}
            </Button>
            {canGoBack && (
              <Button onClick={() => navigate(-1)} type="button" variant="secondary">
                {t('back', 'Назад')}
              </Button>
            )}
          </>
        }
        icon={offline ? 'wifiOff' : 'warning'}
        text={
          offline
            ? t('errorScreen.offlineText', 'CraneApp откроется, когда появится сеть.')
            : t(
                'errorScreen.text',
                'Перезагрузите страницу. Если ошибка повторится, попробуйте позже.'
              )
        }
        title={
          offline
            ? t('errorScreen.offlineTitle', 'Нет подключения к интернету')
            : t('errorScreen.title', 'Что-то пошло не так')
        }
        tone={offline ? 'warn' : 'neutral'}
      />
    </div>
  );
}

/**
 * Панель чата: список чатов рядом остаётся и работает. «К списку чатов»
 * есть всегда — на телефоне только она возвращает к списку.
 */
export function ChatRouteError({
  reload = reloadPage,
  isOnline = browserOnline,
}: IRouteErrorProps) {
  const t = useScreenTranslation();
  const navigate = useNavigate();
  const kind = useRouteErrorKind(reload, isOnline);

  const toChats = (
    <Button onClick={() => navigate(REACT_ROUTES.CHATS)} type="button" variant="secondary">
      {t('errorScreen.toChats', 'К списку чатов')}
    </Button>
  );
  const reloadButton = (
    <Button onClick={reload} type="button">
      {t('errorScreen.reload', 'Перезагрузить')}
    </Button>
  );

  return (
    <div className="flex flex-1 items-center justify-center p-10">
      {kind === 'notFound' ? (
        // Код ответа не важен: и 404, и адрес не-UUID (400) — «чата нет».
        <ErrorScreen
          actions={toChats}
          icon="warning"
          title={t('errors.chatNotFound', 'Чат не найден')}
        />
      ) : kind === 'offline' ? (
        <ErrorScreen
          actions={
            <>
              {reloadButton}
              {toChats}
            </>
          }
          icon="wifiOff"
          text={t('errorScreen.offlineText', 'CraneApp откроется, когда появится сеть.')}
          title={t('errorScreen.offlineTitle', 'Нет подключения к интернету')}
          tone="warn"
        />
      ) : (
        <ErrorScreen
          actions={
            <>
              {reloadButton}
              {toChats}
            </>
          }
          icon="warning"
          title={t('errors.chatLoad', 'Не удалось загрузить чат')}
        />
      )}
    </div>
  );
}
