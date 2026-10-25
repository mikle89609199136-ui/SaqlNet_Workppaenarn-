import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorScreen } from '@/shared/ui';

interface Props {
  children: ReactNode;
  /** Перезагрузить страницу. Параметром — для тестов. */
  reload?: () => void;
}

interface State {
  failed: boolean;
}

/* Без Suspense и с запасными строками, как у RouteLoadingFallback: экран
   обязан показаться и тогда, когда переводы не загрузились. */
function AppCrashScreen({ reload }: { reload: () => void }) {
  const { t } = useTranslation(undefined, { useSuspense: false });

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-ground p-6">
      <ErrorScreen
        actions={
          <Button onClick={reload} type="button">
            {t('errorScreen.reload', 'Перезагрузить')}
          </Button>
        }
        icon="warning"
        text={t(
          'errorScreen.text',
          'Перезагрузите страницу. Если ошибка повторится, попробуйте позже.'
        )}
        title={t('errorScreen.title', 'Что-то пошло не так')}
      />
    </div>
  );
}

/**
 * Граница ошибок вокруг всего приложения (#1071).
 *
 * Оверлей звонка, менеджеры уведомлений и обновлений стоят рядом с
 * роутером, а не внутри него: граница маршрутов их не покрывает. Исключение
 * при их отрисовке размонтировало бы всё дерево, и экран остался бы белым.
 * Роутера здесь нет, поэтому кнопка одна — «Перезагрузить».
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <AppCrashScreen reload={this.props.reload ?? (() => window.location.reload())} />;
  }
}
