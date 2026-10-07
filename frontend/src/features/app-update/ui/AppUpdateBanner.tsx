import { useTranslation } from 'react-i18next';
import { Banner, Button, Icon } from '@/shared/ui';
import { dismissUpdate, useAppUpdateStore } from '../model/appUpdate';
import { useUpdateAction } from './useUpdateAction';

/**
 * Плашка «Доступна новая версия» над списком чатов (#892). Закрыть — до
 * следующей новой сборки; обновиться можно и из «О приложении».
 */
export function AppUpdateBanner(props: Parameters<typeof useUpdateAction>[0]) {
  const { t } = useTranslation();
  const remote = useAppUpdateStore((state) => state.remote);
  const dismissedBuild = useAppUpdateStore((state) => state.dismissedBuild);
  const { label, busy, start, dialog } = useUpdateAction(props);

  if (!remote || (remote.build === dismissedBuild && !busy)) return null;

  return (
    <>
      <Banner
        action={
          <span className="flex items-center gap-1">
            <Button disabled={busy} onClick={start} size="sm" variant="primary">
              {label}
            </Button>
            {!busy && (
              <button
                aria-label={t('appUpdate.close', 'Не сейчас')}
                className="flex size-8 cursor-pointer items-center justify-center rounded-pill text-ink-3 hover:layer-hover"
                onClick={dismissUpdate}
                type="button"
              >
                <Icon className="size-4" name="cross" />
              </button>
            )}
          </span>
        }
        className="mx-3 mb-2"
        icon="download"
      >
        <b>{t('appUpdate.title', 'Новая версия')}</b>{' '}
        {t('appUpdate.available', '{{version}} — обновите, чтобы получить исправления.', {
          version: remote.version,
        })}
      </Banner>
      {dialog}
    </>
  );
}
