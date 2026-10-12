import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Icon } from '@/shared/ui';
import { enablePush, usePushStore } from '../model/pushNotifications';

const DISMISSED_KEY = 'craneapp_push_prompt_dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Плашка «Включить уведомления» над списком чатов (#882).
 *
 * Разрешение — только по нажатию: iPhone иначе не спросит, а браузер без
 * жеста считает запрос навязчивым. На iPhone вне установленного приложения
 * — подсказка, как установить: push там работает только у приложения на
 * экране «Домой». Закрыли, включили или запретили — больше не появляется;
 * включить можно в настройках.
 */
export function PushPrompt({ enable = enablePush }: { enable?: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const status = usePushStore((state) => state.status);
  const busy = usePushStore((state) => state.busy);
  const [dismissed, setDismissed] = useState(readDismissed);

  const permissionAsked =
    typeof Notification !== 'undefined' && Notification.permission !== 'default';
  const showEnable = status === 'off' && !permissionAsked;
  const showInstall = status === 'needs-install';
  if (dismissed || (!showEnable && !showInstall)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // приватный режим — до перезагрузки
    }
    setDismissed(true);
  };

  const close = (
    <button
      aria-label={t('push.prompt.close', 'Не сейчас')}
      className="flex size-8 cursor-pointer items-center justify-center rounded-pill text-ink-3 hover:layer-hover"
      onClick={dismiss}
      type="button"
    >
      <Icon className="size-4" name="cross" />
    </button>
  );

  if (showInstall) {
    return (
      <Banner action={close} className="mx-3 mb-2" icon="bell">
        <b>{t('push.install.title', 'Уведомления на iPhone')}</b>{' '}
        {t(
          'push.install.text',
          'приходят в установленное приложение: «Поделиться» → «На экран «Домой»», затем откройте CraneApp оттуда.'
        )}
      </Banner>
    );
  }

  return (
    <Banner
      action={
        <span className="flex items-center gap-1">
          <Button disabled={busy} onClick={() => void enable()} size="sm" variant="primary">
            {t('push.prompt.enable', 'Включить')}
          </Button>
          {close}
        </span>
      }
      className="mx-3 mb-2"
      icon="bell"
    >
      <b>{t('push.prompt.title', 'Уведомления')}</b>{' '}
      {t('push.prompt.text', '— о сообщениях и звонках, когда приложение закрыто.')}
    </Banner>
  );
}
