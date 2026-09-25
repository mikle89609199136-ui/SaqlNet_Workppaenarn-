import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ui';

export interface IBlockUserConfirmDialogProps {
  open: boolean;
  confirming?: boolean;
  userName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BlockUserConfirmDialog({
  open,
  confirming = false,
  userName,
  onConfirm,
  onCancel,
}: IBlockUserConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      cancelLabel={t('cancel', 'Отмена')}
      confirmLabel={t('settings.privacy.block', 'Заблокировать')}
      confirming={confirming}
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
      open={open}
      title={t('settings.privacy.blockConfirmTitle', 'Заблокировать пользователя?')}
    >
      {t(
        'settings.privacy.blockConfirmMessage',
        'Пользователь не сможет отправлять вам сообщения и совершать звонки.'
      )}
    </ConfirmDialog>
  );
}
