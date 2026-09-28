import { useRealtimeSocket } from '@/shared/api';
import { cn, useConnectionStatus } from '@/shared/lib';
import { Icon } from '@/shared/ui';
import { useTranslation } from 'react-i18next';

/**
 * Плашка связи под шапкой чата — по макету (#826).
 *
 * Нет сети — на подложке предупреждения, с «Повторить»; сеть есть, но
 * сервер не отвечает — «Подключаемся…» со спиннером. Появляется не сразу:
 * короткие моргания связи отсекает сам `connectionStatus`.
 */
export function ConnectionBanner() {
  const { t } = useTranslation();
  const status = useConnectionStatus();
  // Без подключения: соединением распоряжается приложение, здесь нужен
  // только способ попросить его переподключиться сейчас.
  const { socket } = useRealtimeSocket(false);

  if (status === 'connected') return null;
  const offline = status === 'offline';

  return (
    <div
      className={cn(
        'flex min-h-10 shrink-0 items-center gap-2.5 border-b border-divider px-4 py-2 text-caption text-ink',
        offline ? 'bg-warn-soft' : 'bg-sheet-2'
      )}
      role="status"
    >
      {offline ? (
        <Icon aria-hidden="true" className="size-4 shrink-0 stroke-2 text-warn" name="wifiOff" />
      ) : (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin rounded-pill border-2 border-current border-r-transparent motion-reduce:animate-none"
        />
      )}
      <span className="grow">
        {offline
          ? t('connection.offline', 'Нет связи. Сообщения уйдут, когда появится сеть.')
          : t('connection.connecting', 'Подключаемся…')}
      </span>
      {offline && (
        <button
          className="h-7 shrink-0 cursor-pointer rounded-[8px] bg-sheet-2 px-3 text-caption font-semibold hover:layer-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          onClick={() => socket.reconnectNow()}
          type="button"
        >
          {t('retry', 'Повторить')}
        </button>
      )}
    </div>
  );
}
