import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ui';

interface Props {
  open: boolean;
  name: string;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Подтверждение блокировки: что будет и где это отменить (#727). */
export function BlockConfirmDialog({ open, name, confirming, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      confirmLabel={t('block', 'Заблокировать')}
      confirming={confirming}
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
      open={open}
      title={t('blockConfirmTitle', { name, defaultValue: 'Заблокировать {{name}}?' })}
    >
      {t(
        'blockConfirmText',
        'Этот человек не сможет писать вам и звонить. Разблокировать можно в его профиле или в «Настройки → Конфиденциальность → Чёрный список».'
      )}
    </ConfirmDialog>
  );
}
