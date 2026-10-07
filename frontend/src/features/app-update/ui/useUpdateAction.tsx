import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ui';
import {
  requestUpdate,
  updateLosesUnsavedWork,
  useAppUpdateStore,
  type TUpdateWait,
} from '../model/appUpdate';

/**
 * «Обновить» с предупреждением: черновики и неотправленные сообщения живут
 * только в этой вкладке и при перезагрузке пропадут.
 */
export function useUpdateAction({
  request = requestUpdate,
  losesUnsavedWork = updateLosesUnsavedWork,
}: { request?: () => void; losesUnsavedWork?: () => boolean } = {}) {
  const { t } = useTranslation();
  const requested = useAppUpdateStore((state) => state.requested);
  const waitingFor = useAppUpdateStore((state) => state.waitingFor);
  const [asking, setAsking] = useState(false);

  const waitLabels: Record<TUpdateWait, string> = {
    sending: t('appUpdate.waitSending', 'Отправляются сообщения…'),
    call: t('appUpdate.waitCall', 'Обновится после звонка'),
    recording: t('appUpdate.waitRecording', 'Обновится после записи'),
  };
  const label = !requested
    ? t('appUpdate.update', 'Обновить')
    : waitingFor
      ? waitLabels[waitingFor]
      : t('appUpdate.applying', 'Обновляется…');

  const start = () => {
    if (losesUnsavedWork()) setAsking(true);
    else request();
  };

  const dialog = (
    <ConfirmDialog
      confirmLabel={t('appUpdate.update', 'Обновить')}
      onCancel={() => setAsking(false)}
      onConfirm={() => {
        setAsking(false);
        request();
      }}
      open={asking}
      title={t('appUpdate.confirmTitle', 'Обновить приложение?')}
    >
      {t(
        'appUpdate.confirmText',
        'Недописанные и неотправленные сообщения пропадут: они хранятся только в этом окне.'
      )}
    </ConfirmDialog>
  );

  return { label, busy: requested, start, dialog };
}
